(function () {
    'use strict';

    var PLUGIN_ID    = 'firebase_sync';
    var PLUGIN_NAME  = 'Firebase Sync';
    var DEFAULT_URL  = 'https://firebaseio.com';
    var SAVE_INTERVAL = 25000;
    var PULL_INTERVAL = 5 * 60 * 1000;
    var ROW_LIMIT = 4;
    var MIN_TIME    = 30;
    var MAX_PERCENT = 92;
    var ROW_TITLE  = '🍿 ГДЕ ВЫ ОСТАНОВИЛИСЬ?';
    var ROW_MARKER = 'fbsync-row';

    var ST_URL   = 'fbsync_url';
    var ST_ROOM  = 'fbsync_room';
    var ST_ON    = 'fbsync_enabled';

    var lastSaveTime = 0;
    var currentPlay  = null;
    var cloudItems   = [];
    var suppressHook = false;
    var pendingResume = null;
    var pullTimer    = null;

    function log() { if (window.console && console.log) console.log.apply(console, ['[' + PLUGIN_NAME + ']'].concat(Array.prototype.slice.call(arguments))); }
    function storage(key, def) { try { return Lampa.Storage.get(key, def); } catch (e) { return def; } }
    function baseUrl() { return (storage(ST_URL, '') || '').toString().trim().replace(/\/+$/, ''); }
    function roomId() { return String(storage(ST_ROOM, 'family') || 'family').replace(/[.$#\[\]\/\s]/g, '_') || 'family'; }
    function sanitizeKey(str) { return String(str === undefined || str === null ? '' : str).replace(/[.$#\[\]\/\s]/g, '_').substr(0, 120); }
    function enabled() { var url = baseUrl(); return storage(ST_ON, true) && url && url.indexOf('http') === 0 && url !== DEFAULT_URL; }

    function request(method, path, data, success, error) {
        if (!enabled()) return;
        var options = {
            url: baseUrl() + path, type: method, dataType: 'json', timeout: 15000,
            success: success || function () {},
            error: error || function () {}
        };
        if (data !== undefined && data !== null) { options.contentType = 'application/json'; options.data = JSON.stringify(data); }
        if (window.$) $.ajax(options);
    }

    function describePlay(data) {
        if (!data || typeof data !== 'object') data = {};
        var act = {}; try { act = Lampa.Activity.active() || {}; } catch (e) {}
        var card = data.card || data.movie || act.movie || act.card || {};
        if (!card || typeof card !== 'object') card = {};
        var title = card.title || card.name || data.title || '';
        var img   = card.img || card.poster_path || card.poster || data.img || '';
        if (img && img.indexOf('http') !== 0 && Lampa.TMDB && Lampa.TMDB.image) img = Lampa.TMDB.image('t/p/w300' + img);
        var se = detectEpisode(data, card, act);
        return {
            component: act.component && act.component !== 'main' ? act.component : '',
            hash: (data.timeline && data.timeline.hash) || '',
            id: card.id || sanitizeKey(title || data.title), title: title || data.title || 'Без названия', img: img,
            source: card.source || data.source || act.source || 'tmdb', season: se.season, episode: se.episode, card: compactCard(card)
        };
    }

    function detectEpisode(data, card, act) {
        var season  = parseInt(data.season  || act.season  || card.season  || 0, 10) || 0;
        var episode = parseInt(data.episode || act.episode || card.episode || 0, 10) || 0;
        if (season > 0 || episode > 0) return { season: season, episode: episode };
        var title = String(data.title || '');
        var m = title.match(/[sS](\d{1,2})[\s._-]*[eE](\d{1,3})/); if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
        m = title.match(/(\d{1,2})\s*сезон[\s\S]{0,12}?(\d{1,3})\s*сери/i); if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
        m = title.match(/сезон\s*(\d{1,2})[\s\S]{0,12}?сери\w*\s*(\d{1,3})/i); if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
        return { season: 0, episode: 0 };
    }

    function compactCard(card) {
        if (!card || !card.id) return null;
        return { id: card.id, source: card.source || 'tmdb', title: card.title || card.name || '', name: card.name || card.title || '', original_title: card.original_title || card.original_name || '', original_name: card.original_name || card.original_title || '', poster_path: card.poster_path || '', backdrop_path: card.backdrop_path || '', release_date: card.release_date || '', first_air_date: card.first_air_date || '', number_of_seasons: card.number_of_seasons || 0, vote_average: card.vote_average || 0 };
    }

    function itemKey(item) {
        var parts = [item.source || 'tmdb', item.id];
        if (item.season > 0) parts.push('s' + item.season, 'e' + item.episode);
        return sanitizeKey(parts.join('_'));
    }

    function saveProgress(hash, time, duration, force) {
        if (!enabled()) return;
        time = Number(time) || 0; duration = Number(duration) || 0;
        if (duration < 1 || time < MIN_TIME) return;
        var percent = time / duration * 100; if (percent > MAX_PERCENT) return;
        var now = Date.now(); if (!force && now - lastSaveTime < SAVE_INTERVAL) return;
        var movie = currentPlay; if (!movie || (hash && movie.hash && movie.hash !== hash)) movie = describePlay(playerData());
        if (!movie || !movie.title) return;
        lastSaveTime = now;
        var payload = { id: movie.id, title: movie.title, img: movie.img, source: movie.source, time: Math.round(time), duration: Math.round(duration), season: movie.season, episode: movie.episode, percent: Math.round(percent), hash: hash || movie.hash || '', component: movie.component || '', card: movie.card, timestamp: now };
        request('PUT', '/history/' + roomId() + '/' + itemKey(payload) + '.json', payload);
    }

    function playerData() { try { if (Lampa.Player) { if (Lampa.Player.playdata) return Lampa.Player.playdata() || {}; if (Lampa.Player.data) return Lampa.Player.data() || {}; } } catch (e) {} return {}; }

    function pullHistory(callback) {
        if (!enabled()) return;
        request('GET', '/history/' + roomId() + '.json', null, function (data) {
            var items = [];
            for (var key in data) { if (data.hasOwnProperty(key) && data[key] && data[key].title && data[key].time) items.push(data[key]); }
            items.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
            cloudItems = items.slice(0, ROW_LIMIT);
            mergeTimeline(cloudItems);
            if (callback) callback(cloudItems);
        });
    }

    function mergeTimeline(items) {
        if (!Lampa.Timeline || !Lampa.Timeline.view) return;
        suppressHook = true;
        items.forEach(function (item) {
            if (!item.hash || !item.duration) return;
            try {
                var view = Lampa.Timeline.view(item.hash);
                if (!view.time || view.time < item.time) Lampa.Timeline.update({ hash: item.hash, time: item.time, duration: item.duration, percent: Math.round(item.time / item.duration * 100), received: true, updated: item.timestamp || Date.now() });
            } catch (e) {}
        });
        suppressHook = false;
    }

    function formatTime(sec) {
        sec = Math.round(sec || 0); var h = Math.floor(sec / 3600); var m = Math.floor((sec % 3600) / 60); var s = sec % 60;
        function pad(n) { return n < 10 ? '0' + n : '' + n; } return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
    }

    function hookTimeline() {
        if (!Lampa.Timeline || !Lampa.Timeline.update || Lampa.Timeline.__fbsync_hooked) return;
        var original = Lampa.Timeline.update;
        Lampa.Timeline.update = function (params) {
            var result = original.apply(this, arguments);
            try { if (!suppressHook && params && params.hash && !params.received) { var road = Lampa.Timeline.view(params.hash); saveProgress(params.hash, road.time, road.duration, false); } } catch (e) {}
            return result;
        };
        Lampa.Timeline.__fbsync_hooked = true;
    }

    function hookPlayer() {
        if (!Lampa.Player || !Lampa.Player.play || Lampa.Player.__fbsync_hooked) return;
        var original = Lampa.Player.play;
        Lampa.Player.play = function (data) {
            try {
                if (pendingResume && data && typeof data === 'object') {
                    var fresh = Date.now() - pendingResume.at < 3 * 60 * 1000;
                    var sameEpisode = !pendingResume.episode || !data.episode || parseInt(data.episode, 10) === pendingResume.episode;
                    if (fresh && sameEpisode) {
                        if (!data.timeline) data.timeline = {};
                        if (!data.timeline.time || data.timeline.time < pendingResume.time) {
                            data.timeline.time = pendingResume.time;
                            if (data.timeline.duration) data.timeline.percent = Math.round(pendingResume.time / data.timeline.duration * 100);
                            if (Lampa.Noty) Lampa.Noty.show('FB: старт с ' + formatTime(pendingResume.time));
                        }
                    }
                }
            } catch (e) {}
            pendingResume = null;
            return original.apply(this, arguments);
        };
        Lampa.Player.__fbsync_hooked = true;
    }

    function bindPlayer() {
        function onStart(data) { currentPlay = describePlay(data); lastSaveTime = 0; }
        function onDestroy() { if (currentPlay && currentPlay.hash) { try { var road = Lampa.Timeline.view(currentPlay.hash); saveProgress(currentPlay.hash, road.time, road.duration, true); } catch (e) {} } currentPlay = null; setTimeout(refresh, 1500); }
        if (Lampa.Player && Lampa.Player.listener) { Lampa.Player.listener.follow('start', onStart); Lampa.Player.listener.follow('ready', onStart); Lampa.Player.listener.follow('destroy', onDestroy); }
        try { Lampa.Listener.follow('player', function (e) { if (!e) return; if (e.type === 'start' || e.type === 'ready') onStart(e.data || e.playdata || e); if (e.type === 'destroy') onDestroy(); }); } catch (e) {}
    }

    function refresh() { pullHistory(); }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;
        Lampa.SettingsApi.addComponent({ component: PLUGIN_ID, name: PLUGIN_NAME, icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6l4 2.4-.8 1.3-4.7-2.8V6h1.5v6.6z"/></svg>' });
        Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: ST_ON, type: 'trigger', "default": true }, field: { name: 'Синхронизация Firebase', description: 'Вкл/Выкл' }, onChange: function () { if (enabled()) refresh(); } });
        Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: ST_URL, type: 'input', values: '', "default": '' }, field: { name: 'URL базы Firebase', description: 'Нажми и введи ссылку (https://...)' }, onChange: function () { refresh(); } });
        Lampa.SettingsApi.addParam({ component: PLUGIN_ID, param: { name: ST_ROOM, type: 'input', values: '', "default": 'family' }, field: { name: 'Имя комнаты', description: 'Одинаковое на ТВ и телефоне' }, onChange: function () { refresh(); } });
    }

    function startPlugin() {
        if (window[PLUGIN_ID + '_ready']) return;
        window[PLUGIN_ID + '_ready'] = true;
        addSettings();
        hookTimeline();
        hookPlayer();
        bindPlayer();
        if (enabled()) { refresh(); if (pullTimer) clearInterval(pullTimer); pullTimer = setInterval(refresh, PULL_INTERVAL); }
    }

    if (window.appready) startPlugin();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') startPlugin(); });
})();
