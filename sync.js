(function () {
    'use strict';

    var PLUGIN_ID   = 'simple_fb_sync';
    var PLUGIN_NAME = 'Синх. Firebase';
    
    var ST_URL  = 'simple_fb_url';
    var ST_ROOM = 'simple_fb_room';

    function storage(key, def) {
        try {
            if (window.Lampa && Lampa.Storage) return Lampa.Storage.get(key, def);
        } catch (e) {}
        return def;
    }

    function setStorage(key, val) {
        try {
            if (window.Lampa && Lampa.Storage) Lampa.Storage.set(key, val);
        } catch (e) {}
    }

    function getBaseUrl() {
        var url = (storage(ST_URL, '') || '').toString().trim();
        return url.replace(/\/+$/, '');
    }

    function getRoom() {
        var room = (storage(ST_ROOM, 'my_home') || 'my_home').toString().trim();
        return String(room).replace(/[.$#\[\]\/\s]/g, '_') || 'my_home';
    }

    function pushProgress(data) {
        var url = getBaseUrl();
        if (!url || url.indexOf('http') !== 0) return;
        if (!data || !data.hash || !data.time || data.time < 15) return;
        if (!window.$ || !$.ajax) return;

        var cleanHash = String(data.hash).replace(/[.$#\[\]\/\s]/g, '_');
        var payload = {
            hash: data.hash,
            time: Math.round(data.time),
            duration: Math.round(data.duration || 0),
            updated: Date.now()
        };

        $.ajax({
            url: url + '/history/' + getRoom() + '/' + cleanHash + '.json',
            type: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            dataType: 'json'
        });
    }

    function pullProgress() {
        var url = getBaseUrl();
        if (!url || url.indexOf('http') !== 0) return;
        if (!window.$ || !$.ajax || !window.Lampa || !Lampa.Timeline) return;

        $.ajax({
            url: url + '/history/' + getRoom() + '.json',
            type: 'GET',
            dataType: 'json',
            success: function (res) {
                if (!res) return;
                for (var key in res) {
                    var item = res[key];
                    if (item && item.hash && item.time) {
                        try {
                            var local = Lampa.Timeline.view(item.hash);
                            if (!local || !local.time || local.time < item.time) {
                                Lampa.Timeline.update({
                                    hash: item.hash,
                                    time: item.time,
                                    duration: item.duration || 0,
                                    percent: Math.round((item.time / (item.duration || 1)) * 100),
                                    received: true
                                });
                            }
                        } catch (e) {}
                    }
                }
            }
        });
    }

    function addSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: PLUGIN_NAME,
            icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6l4 2.4-.8 1.3-4.7-2.8V6h1.5v6.6z"/></svg>'
        });

        // ВОТ ОНА, МАГИЯ: передаем values: '' и "default" в кавычках
        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: ST_URL, type: 'input', values: '', "default": '' },
            field: { name: 'URL базы Firebase', description: 'Нажми и введи ссылку (https://...)' },
            onChange: function (val) {
                setStorage(ST_URL, val);
                pullProgress();
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: ST_ROOM, type: 'input', values: '', "default": 'my_home' },
            field: { name: 'Имя комнаты', description: 'Одинаковое на ТВ и телефоне' },
            onChange: function (val) {
                setStorage(ST_ROOM, val);
                pullProgress();
            }
        });
    }

    function startPlugin() {
        if (window[PLUGIN_ID + '_ready']) return;
        window[PLUGIN_ID + '_ready'] = true;

        addSettings();

        if (window.Lampa && Lampa.Timeline && Lampa.Timeline.listener) {
            Lampa.Timeline.listener.follow('update', function (data) {
                if (data && !data.received) pushProgress(data);
            });
        }

        pullProgress();
        window.addEventListener('focus', pullProgress);
        
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('activity', function (e) {
                if (e && (e.type === 'start' || e.component === 'main')) pullProgress();
            });
        }

        setInterval(pullProgress, 15000);
    }

    if (window.appready) {
        startPlugin();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }
})();
