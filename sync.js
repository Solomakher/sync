(function () {
    'use strict';

    var ST_URL  = 'simple_fb_url';
    var ST_ROOM = 'simple_fb_room';

    function getBaseUrl() {
        try { return (window.Lampa && Lampa.Storage ? Lampa.Storage.get(ST_URL, '') : '').toString().trim().replace(/\/+$/, ''); } catch (e) { return ''; }
    }

    function getRoom() {
        try { return (window.Lampa && Lampa.Storage ? Lampa.Storage.get(ST_ROOM, 'my_home') : 'my_home').toString().trim().replace(/[.$#\[\]\/\s]/g, '_') || 'my_home'; } catch (e) { return 'my_home'; }
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

    function start() {
        // Внедряем настройки в стандартную вкладку "Интерфейс" (component: 'interface')
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param: { name: ST_URL, type: 'input', default: '' },
                field: { name: 'Firebase: URL базы', description: 'Ссылка для синхронизации истории' },
                onChange: function () { pullProgress(); }
            });

            Lampa.SettingsApi.addParam({
                component: 'interface',
                param: { name: ST_ROOM, type: 'input', default: 'my_home' },
                field: { name: 'Firebase: Имя комнаты', description: 'Одинаковое на ТВ и телефоне' },
                onChange: function () { pullProgress(); }
            });
        }

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
        start();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
