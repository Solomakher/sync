(function () {
    'use strict';

    var ST_URL  = 'simple_fb_url';
    var ST_ROOM = 'simple_fb_room';

    function storage(key, def) {
        try { if (window.Lampa && Lampa.Storage) return Lampa.Storage.get(key, def); } catch (e) {}
        return def;
    }

    function setStorage(key, val) {
        try { if (window.Lampa && Lampa.Storage) Lampa.Storage.set(key, val); } catch (e) {}
    }

    function getBaseUrl() {
        return (storage(ST_URL, '') || '').toString().trim().replace(/\/+$/, '');
    }

    function getRoom() {
        return String(storage(ST_ROOM, 'my_home') || 'my_home').replace(/[.$#\[\]\/\s]/g, '_') || 'my_home';
    }

    function pushProgress(data) {
        var url = getBaseUrl();
        if (!url || url.indexOf('http') !== 0 || !data || !data.hash || data.time < 15 || !window.$) return;
        var cleanHash = String(data.hash).replace(/[.$#\[\]\/\s]/g, '_');
        $.ajax({
            url: url + '/history/' + getRoom() + '/' + cleanHash + '.json',
            type: 'PUT', contentType: 'application/json',
            data: JSON.stringify({ hash: data.hash, time: Math.round(data.time), duration: Math.round(data.duration || 0), updated: Date.now() })
        });
    }

    function pullProgress() {
        var url = getBaseUrl();
        if (!url || url.indexOf('http') !== 0 || !window.$ || !window.Lampa || !Lampa.Timeline) return;
        $.ajax({
            url: url + '/history/' + getRoom() + '.json', type: 'GET', dataType: 'json',
            success: function (res) {
                if (!res) return;
                for (var k in res) {
                    var item = res[k];
                    if (item && item.hash && item.time) {
                        try {
                            var local = Lampa.Timeline.view(item.hash);
                            if (!local || local.time < item.time) {
                                Lampa.Timeline.update({ hash: item.hash, time: item.time, duration: item.duration || 0, percent: Math.round((item.time / (item.duration || 1)) * 100), received: true });
                            }
                        } catch (e) {}
                    }
                }
            }
        });
    }

    function askSettings() {
        if (!window.Lampa || !Lampa.Input) return;
        Lampa.Input.edit({ title: 'URL базы Firebase (https://...)', value: getBaseUrl(), free: true, nosave: true }, function (url) {
            if (url) {
                setStorage(ST_URL, url.trim());
                setTimeout(function() {
                    Lampa.Input.edit({ title: 'Имя комнаты (напр. my_home)', value: getRoom(), free: true, nosave: true }, function (room) {
                        if (room) {
                            setStorage(ST_ROOM, room.trim());
                            if (Lampa.Noty) Lampa.Noty.show('Firebase настроен!');
                            pullProgress();
                        }
                    });
                }, 300);
            }
        });
    }

    function init() {
        // Если базы еще нет — сразу выкидываем окно при старте
        if (!getBaseUrl()) {
            setTimeout(askSettings, 2000);
        }

        // Создаем свою кнопку FB в верхней правой шапке (рядом с поиском)
        if (window.$) {
            var btn = $('<div class="head__action selector" style="padding: 0 15px; font-weight: bold; color: #fff; cursor: pointer;">FB</div>');
            btn.on('hover:enter click', askSettings);
            $('.head__actions').append(btn);
        }

        if (window.Lampa && Lampa.Timeline && Lampa.Timeline.listener) {
            Lampa.Timeline.listener.follow('update', function (data) { if (data && !data.received) pushProgress(data); });
        }

        pullProgress();
        window.addEventListener('focus', pullProgress);
        if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('activity', function (e) { if (e && (e.type === 'start' || e.component === 'main')) pullProgress(); });
        setInterval(pullProgress, 15000);
    }

    if (window.appready) init();
    else if (window.Lampa && Lampa.Listener) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
