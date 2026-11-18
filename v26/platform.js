// Прослойка между игрой и платформой. Игра зовёт только Platform.*, а не SDK напрямую:
// для Игр ВК/ОК понадобится заменить один этот файл.
// Без SDK (локальная проверка, exp-browser) всё работает на заглушках и localStorage.
const Platform = (() => {
  let ysdk = null, player = null;
  let paused = false;
  const pauseFns = [], resumeFns = [];
  const SAVE_KEY = 'save';

  function loadScript(src, timeout) {
    return new Promise(res => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      const t = setTimeout(() => res(false), timeout);
      s.onload = () => { clearTimeout(t); res(true); };
      s.onerror = () => { clearTimeout(t); res(false); };
      document.head.append(s);
    });
  }

  function setPaused(p) {
    if (p === paused) return;
    paused = p;
    (p ? pauseFns : resumeFns).forEach(f => f());
  }

  async function init() {
    if (await loadScript('/sdk.js', 5000) && window.YaGames) {
      try {
        ysdk = await YaGames.init();
        ysdk.on('game_api_pause', () => setPaused(true));
        ysdk.on('game_api_resume', () => setPaused(false));
        try { player = await ysdk.getPlayer(); } catch (e) { player = null; }
      } catch (e) { console.warn('SDK init failed', e); ysdk = null; }
    }
    // требование 1.3: звук стоп при потере фокуса — ловим сами, не полагаясь только на SDK
    document.addEventListener('visibilitychange', () => setPaused(document.hidden));
    window.addEventListener('blur', () => setPaused(true));
    window.addEventListener('focus', () => setPaused(false));
    // мобильные: без контекстного меню, выделения и прокрутки страницы
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('selectstart', e => e.preventDefault());
    document.addEventListener('touchmove', e => { if (!e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });
  }

  const lang = () => {
    const l = ysdk ? ysdk.environment.i18n.lang : (new URLSearchParams(location.search).get('lang') || 'ru');
    return l;
  };

  const ready = () => ysdk?.features.LoadingAPI?.ready();
  const gameStart = () => ysdk?.features.GameplayAPI?.start();
  const gameStop = () => ysdk?.features.GameplayAPI?.stop();

  // Реклама только в логических паузах (между уровнями). Возвращает Promise, который
  // разрешается, когда игру можно продолжать. На время рекламы — пауза звука и игры.
  function fullscreenAd() {
    if (!ysdk) return Promise.resolve(false);
    return new Promise(res => {
      gameStop();
      ysdk.adv.showFullscreenAdv({ callbacks: {
        onOpen: () => setPaused(true),
        onClose: shown => { setPaused(false); res(shown); },
        onError: () => { setPaused(false); res(false); },
      } });
    });
  }

  // Ролик за награду: true, если награду нужно выдать.
  function rewarded() {
    if (!ysdk) return Promise.resolve(confirm('[локально] Засчитать просмотр рекламы?'));
    return new Promise(res => {
      let got = false;
      gameStop();
      ysdk.adv.showRewardedVideo({ callbacks: {
        onOpen: () => setPaused(true),
        onRewarded: () => { got = true; },
        onClose: () => { setPaused(false); res(got); },
        onError: () => { setPaused(false); res(false); },
      } });
    });
  }

  // Сохранение: в облако Яндекса (если есть игрок) и всегда в localStorage — что новее, то и берём.
  async function load() {
    // Для автора игры: index.html?reset=1 начинает с нуля. Только без SDK,
    // то есть локально — у игроков на площадке параметр ничего не делает.
    // Параметр убирается из адреса, чтобы обновление страницы не стёрло новый прогресс.
    const params = new URLSearchParams(location.search);
    if (!ysdk && params.get('reset') === '1') {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
      params.delete('reset');
      const q = params.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
      return null;
    }
    let local = null, cloud = null;
    try { local = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) {}
    if (player) { try { cloud = (await player.getData([SAVE_KEY]))[SAVE_KEY] || null; } catch (e) {} }
    if (local && cloud) return (cloud.t || 0) >= (local.t || 0) ? cloud : local;
    return cloud || local || null;
  }

  let saveTimer = null, pending = null;
  function save(data, now = false) {
    data.t = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
    if (!player) return;
    // лимит 100 запросов за 5 минут: копим и шлём не чаще раза в 10 секунд
    pending = data;
    const flush = () => { saveTimer = null; const d = pending; pending = null;
      player.setData({ [SAVE_KEY]: d }, true).catch(() => {}); };
    if (now) { clearTimeout(saveTimer); flush(); }
    else if (!saveTimer) saveTimer = setTimeout(flush, 10000);
  }

  return {
    init, lang, ready, gameStart, gameStop, fullscreenAd, rewarded, load, save,
    // для Godot: его мост JavaScriptBridge не передаёт словари, только строки
    loadJSON: async () => JSON.stringify(await load()),
    saveJSON: (s, now) => save(JSON.parse(s), !!now),
    onPause: f => pauseFns.push(f), onResume: f => resumeFns.push(f),
    get paused() { return paused; }, get hasSdk() { return !!ysdk; },
  };
})();

// Мастерская: Godot ищет мост как window.Platform (JavaScriptBridge.get_interface),
// а `const` на верхнем уровне скрипта создаёт глобальную переменную, но не свойство
// window. Без этой строки ya.gd не находит мост и молча работает как вне браузера:
// без рекламы и без облачных сохранений.
window.Platform = Platform;
