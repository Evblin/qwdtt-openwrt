'use strict';

'require view';
'require poll';
'require ui';
'require qwdtt';

function section(title, body) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h2', {}, [ title ]),
		E('div', { 'class': 'cbi-section-node' }, [ body ])
	]);
}

function infoRow(label, value) {
	return E('div', { 'class': 'qwdtt-row' }, [
		E('span', { 'class': 'qwdtt-row-label' }, [ label ]),
		E('div', { 'class': 'qwdtt-row-value' }, [ value ])
	]);
}

function statusBadge(state) {
	return E('span', {
		'class': 'qwdtt-badge ' + (state ? 'qwdtt-badge-running' : 'qwdtt-badge-stopped')
	}, [ state ? _('Running') : _('Stopped') ]);
}

function timeStr(t) {
	var d = new Date(t);
	var p = function(n) { return (n < 10 ? '0' : '') + n; };
	return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

var POLL_INTERVAL = 3;

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	__pollEntry: null,
	__root: null,
	__data: null,
	__prev: null,
	__els: null,

	load: function() {
		return Promise.all([
			qwdtt.load(),
			qwdtt.readConfig(),
			qwdtt.serviceInfo()
		]).then(function(results) {
			var cfg = results[1];
			var info = results[2];
			var tunName = (cfg && typeof cfg.tun_name === 'string' && cfg.tun_name) || 'qwdtt0';

			return Promise.all([
				qwdtt.getTunInfo(tunName).catch(function() { return null; }),
				qwdtt.getTraffic(tunName).catch(function() { return null; }),
				qwdtt.getRoutes(tunName).catch(function() { return []; }),
				qwdtt.getRules().catch(function() { return []; })
			]).then(function(items) {
				return {
					cfg: cfg || {},
					info: info,
					tunName: tunName,
					tun: items[0],
					traffic: items[1],
					routes: items[2],
					rules: items[3],
					cfgError: (cfg && cfg.__error) ? cfg.__error : null
				};
			});
		}).catch(function(err) {
			return { error: err && err.message ? err.message : String(err) };
		});
	},

	render: function(data) {
		var vm = this;

		this.stopPolling();
		this.__prev = null;
		this.__els = null;

		if (data.error) {
			var errNode = E('div', { 'class': 'alert-message warning' }, [
				_('Unable to load qWDTT status:'), ' ', data.error
			]);

			if (this.__root && this.__root.isConnected) {
				L.dom.content(this.__root, errNode);
				return this.__root;
			}

			this.__root = E('div', {}, [ errNode ]);
			return this.__root;
		}

		var info = data.info || { running: false, enabled: false };
		var cfg = data.cfg || {};
		this.__data = data;

		var statusEl = statusBadge(info.running);
		var tunEl = E('span', {}, [ data.tun ? data.tun.address : _('not configured') ]);
		var rxEl = E('span', {}, [ data.traffic ? qwdtt.formatBytes(data.traffic.rxBytes) : _('n/a') ]);
		var txEl = E('span', {}, [ data.traffic ? qwdtt.formatBytes(data.traffic.txBytes) : _('n/a') ]);
		var rxRateEl = E('span', { 'class': 'qwdtt-mono' }, [ _('n/a') ]);
		var txRateEl = E('span', { 'class': 'qwdtt-mono' }, [ _('n/a') ]);
		var updatedEl = E('span', {}, [ _('n/a') ]);

		var enableCb = E('input', { 'type': 'checkbox' });
		enableCb.checked = !!info.enabled;
		enableCb.addEventListener('change', function() {
			qwdtt.setEnabled(enableCb.checked).then(function() {
				ui.addNotification(null, E('p', {}, [ _('Autostart setting updated') ]), 'info', 5000);
				vm.refresh().then(function() { vm.rerender(); });
			}).catch(function(err) {
				enableCb.checked = !enableCb.checked;
				vm.notifyError(err);
			});
		});

		var serviceButtons = E('span', {}, [
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': function() { vm.doAction('start'); }
			}, [ _('Start') ]),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': function() { vm.doAction('stop'); }
			}, [ _('Stop') ]),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': function() { vm.doAction('restart'); }
			}, [ _('Restart') ])
		]);

		var hashCount = Array.isArray(cfg.hashes) ? cfg.hashes.length : 0;
		var workersText = (cfg.workers != null && cfg.workers !== '') ? String(cfg.workers) : _('n/a');

		var routesCountEl = E('span', {}, [ String(data.routes.length) ]);
		var rulesCountEl = E('span', {}, [ String(data.rules.length) ]);

		var root = E('div', { 'class': 'qwdtt-overview' }, [
			section(_('Service'), E('div', {}, [
				infoRow(_('Status'), statusEl),
				infoRow(_('Server'), E('span', { 'class': 'qwdtt-mono' }, [ cfg.peer ? cfg.peer : _('n/a') ])),
				infoRow(_('Workers'), E('span', {}, [ workersText ])),
				infoRow(_('VK hashes'), E('span', {}, [ String(hashCount) ])),
				infoRow(_('Autostart'), enableCb),
				infoRow(_('Config file'), E('span', { 'class': 'qwdtt-mono' }, [ info.configPath ])),
				infoRow(_('Actions'), serviceButtons)
			])),
			section(_('Tunnel'), E('div', {}, [
				infoRow(_('Interface'), E('span', { 'class': 'qwdtt-mono' }, [ data.tunName ])),
				infoRow(_('TUN address'), tunEl),
				infoRow(_('Traffic received'), rxEl),
				infoRow(_('Traffic sent'), txEl),
				infoRow(_('Download rate'), rxRateEl),
				infoRow(_('Upload rate'), txRateEl),
				infoRow(_('Routes via tunnel'), routesCountEl),
				infoRow(_('Policy rules'), rulesCountEl),
				infoRow(_('Last updated'), updatedEl)
			]))
		]);

		var banner = null;
		var tunUp = !!(data.tun && data.tun.address);
		var diagLink = E('a', {
			'href': '#/admin/services/qwdtt/diagnostics',
			'class': 'cbi-button cbi-button-action',
			'style': 'margin-left: 0.5em;'
		}, [ _('Open Diagnostics') ]);

		if (data.cfgError)
			banner = E('div', { 'class': 'alert-message error' }, [ data.cfgError ]);
		else if (!info.enabled)
			banner = E('div', { 'class': 'alert-message warning' }, [
				_('The service is disabled. Enable autostart above, then press Start.')
			]);
		else if (!info.running)
			banner = E('div', { 'class': 'alert-message warning' }, [
				_('The service is not running. Check the configuration on the Settings page.'), diagLink
			]);
		else if (!tunUp)
			banner = E('div', { 'class': 'alert-message warning' }, [
				_('The service is running, but the tunnel is not up: the TUN interface has no address yet. Check the service log and the Settings page.'), diagLink
			]);
		else
			banner = E('div', { 'class': 'alert-message notice' }, [
				_('The service is up and forwarding traffic.')
			]);

		root.insertBefore(banner, root.firstChild);

		this.__root = root;
		this.__els = { status: statusEl, tun: tunEl, rx: rxEl, tx: txEl, rxRate: rxRateEl, txRate: txRateEl, routes: routesCountEl, rules: rulesCountEl, updated: updatedEl };

		this.__prev = {
			t: Date.now(),
			rx: data.traffic ? data.traffic.rxBytes : null,
			tx: data.traffic ? data.traffic.txBytes : null
		};

		this.__pollEntry = poll.add(function() {
			vm.refresh().then(function() {
				if (vm.__root && vm.__root.isConnected)
					vm.patch();
				else
					vm.stopPolling();
			});
		}, POLL_INTERVAL);

		return root;
	},

	refresh: function() {
		var vm = this;
		var tunName = (this.__data && this.__data.tunName) || 'qwdtt0';

		return Promise.all([
			qwdtt.serviceInfo(),
			qwdtt.readConfig().catch(function() { return null; })
		]).then(function(results) {
			var info = results[0];
			var cfg = results[1];
			if (cfg && typeof cfg.tun_name === 'string' && cfg.tun_name)
				tunName = cfg.tun_name;

			return Promise.all([
				qwdtt.getTunInfo(tunName).catch(function() { return null; }),
				qwdtt.getTraffic(tunName).catch(function() { return null; }),
				qwdtt.getRoutes(tunName).catch(function() { return []; }),
				qwdtt.getRules().catch(function() { return []; })
			]).then(function(items) {
				vm.__data = vm.__data || {};
				vm.__data.info = info;
				vm.__data.tunName = tunName;
				vm.__data.tun = items[0];
				vm.__data.traffic = items[1];
				vm.__data.routes = items[2];
				vm.__data.rules = items[3];
				return vm.__data;
			});
		}).catch(function(err) {
			vm.notifyError(err);
		});
	},

	patch: function() {
		var data = this.__data;
		if (!data || !this.__els)
			return;

		if (data.info)
			L.dom.content(this.__els.status, statusBadge(data.info.running));
		L.dom.content(this.__els.tun, data.tun ? data.tun.address : _('not configured'));
		L.dom.content(this.__els.rx, data.traffic ? qwdtt.formatBytes(data.traffic.rxBytes) : _('n/a'));
		L.dom.content(this.__els.tx, data.traffic ? qwdtt.formatBytes(data.traffic.txBytes) : _('n/a'));
		L.dom.content(this.__els.routes, String((data.routes || []).length));
		L.dom.content(this.__els.rules, String((data.rules || []).length));

		var now = Date.now();
		if (data.traffic && this.__prev && this.__prev.rx != null) {
			var dt = (now - this.__prev.t) / 1000;
			if (dt > 0 && dt < 90) {
				L.dom.content(this.__els.rxRate, qwdtt.formatRate(Math.max(0, data.traffic.rxBytes - this.__prev.rx) / dt));
				L.dom.content(this.__els.txRate, qwdtt.formatRate(Math.max(0, data.traffic.txBytes - this.__prev.tx) / dt));
			}
		}

		this.__prev = {
			t: now,
			rx: data.traffic ? data.traffic.rxBytes : null,
			tx: data.traffic ? data.traffic.txBytes : null
		};

		if (this.__els.updated)
			L.dom.content(this.__els.updated, timeStr(now));
	},

	rerender: function() {
		var vm = this;
		return this.refresh().then(function() {
			var doc = vm.render(vm.__data || {});
			var vp = document.getElementById('view');
			L.dom.content(vp, doc);
			L.dom.append(vp, vm.addFooter());
		});
	},

	stopPolling: function() {
		if (this.__pollEntry) {
			poll.remove(this.__pollEntry);
			this.__pollEntry = null;
		}
	},

	remove: function() {
		this.stopPolling();
	},

	doAction: function(action) {
		var vm = this;

		if (action === 'start' && vm.__data && vm.__data.info && !vm.__data.info.enabled) {
			ui.addNotification(null, E('p', {}, [
				_('Cannot start: the service is disabled. Enable autostart first.')
			]), 'error', 8000);
			return;
		}

		var msg = _('Please wait…');
		if (action === 'start')
			msg = _('Starting the service…');
		else if (action === 'stop')
			msg = _('Stopping the service…');
		else if (action === 'restart')
			msg = _('Restarting the service…');

		ui.addNotification(null, E('p', {}, [ msg ]), 'info', 3000);

		qwdtt.serviceAction(action).then(function() {
			return vm.refresh().then(function() { vm.rerender(); });
		}).catch(function(err) {
			vm.notifyError(err);
		});
	},

	notifyError: function(err) {
		ui.addNotification(null, E('p', {}, [
			_('An error occurred:'), ' ',
			(err && err.message) ? err.message : String(err)
		]), 'error', 10000);
	}
});