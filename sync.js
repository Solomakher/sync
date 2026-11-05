(function () {
    'use strict';

    var PLUGIN_ID   = 'simple_fb_sync';
    var PLUGIN_NAME = 'Синхронизация Firebase';

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

    function isConfigured() {
        var url = getBaseUrl();
        return url && url.indexOf('http') === 0;
    }

    function pushProgress(data) {
        if (!isConfigured()) return;
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
            url: getBaseUrl() + '/history/' + getRoom() + '/' + cleanHash + '.json',
            type: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(payload),
            dataType: 'json'
        });
    }

    function pullProgress() {
        if (!isConfigured()) return;
        if (!window.$ || !$.ajax || !window.Lampa || !Lampa.Timeline) return;

        $.ajax({
            url: getBaseUrl() + '/history/' + getRoom() + '.json',
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

        try {
            Lampa.SettingsApi.addComponent({
                component: PLUGIN_ID,
                name: PLUGIN_NAME,
                icon: '<svg height="36" viewBox="0 0 24 24" width="36" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>'
            });

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: {
                    name: ST_URL,
                    type: 'static'
                },
                field: {
                    name: 'URL базы Firebase',
                    description: getBaseUrl() || 'Нажмите, чтобы ввести адрес'
                },
                onRender: function (item) {
                    function openUrlInput() {
                        Lampa.Input.edit({
                            title: 'URL базы Firebase',
                            value: getBaseUrl(),
                            free: true,
                            nosave: true
                        }, function (new_val) {
                            if (new_val !== undefined && new_val !== null) {
                                setStorage(ST_URL, new_val.trim());
                                item.find('.settings-param__descr').text(new_val.trim() || 'Нажмите, чтобы ввести адрес');
                                pullProgress();
                            }
                        });
                    }

                    item.on('hover:enter click', openUrlInput);
                }
            });

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: {
                    name: ST_ROOM,
                    type: 'static'
                },
                field: {
                    name: 'Имя комнаты',
                    description: getRoom()
                },
                onRender: function (item) {
                    function openRoomInput() {
                        Lampa.Input.edit({
                            title: 'Имя комнаты',
                            value: getRoom(),
                            free: true,
                            nosave: true
                        }, function (new_val) {
                            if (new_val !== undefined && new_val !== null) {
                                setStorage(ST_ROOM, new_val.trim());
                                item.find('.settings-param__descr').text(new_val.trim() || 'my_home');
                                pullProgress();
                            }
                        });
                    }

                    item.on('hover:enter click', openRoomInput);
                }
            });
        } catch (e) {}
    }

    function start() {
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
                if (e && (e.type === 'start' || e.component === 'main')) {
                    pullProgress();
                }
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
