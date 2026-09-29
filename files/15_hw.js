'use strict';
'require baseclass';
'require fs';
'require rpc';
'require uci';
'require hardware_status';

/*
 * ZNXT ZN515XG-D: hardware status block for Status -> Overview.
 *
 * Shipped by the package luci-app-zn515xg-hw under the *new* file name
 * view/status/include/15_hw.js.  The overview page discovers its includes by
 * scanning that directory at runtime
 * (luci-mod-status .../view/status/index.js: fs.list() -> filter *.js ->
 * sort -> L.require('view.status.include.<name>')), so a new file name gets
 * picked up without touching a single file owned by luci-mod-status - and
 * therefore without the path collision apk raises when two packages own the
 * same path.  "15_" sorts right after the stock 10_system.js.
 *
 * The stock "System" block is taken over, not duplicated: this package's
 * postinst renames luci-mod-status' own 10_system.js to 10_system.js.disabled
 * (no longer *.js, so the directory scan stops picking it up) and postrm
 * renames it back when the package is removed.  Should a later apk operation
 * reinstall luci-mod-status, the stock block simply re-appears *alongside*
 * this one - nothing is lost: the user can hide it with its own Hide button,
 * or reinstall this package.
 *
 * The layout is the stock block's field set with render() rewritten into two
 * side by side panes:
 *
 *   +----------------------------+   +---------------------+
 *   | 温度          CPU 占用率    |   |  设备信息            |
 *   |                            |   |  (single column of   |
 *   | Pon 端口速率   连接数       |   |   board metadata)    |
 *   +----------------------------+   +---------------------+
 *
 *       left, 3 parts                     right, 2 parts
 *
 * The left pane holds the four metric cards as a 2x2 grid, the right one the
 * metadata surface.  On narrow screens the panes wrap onto separate rows.
 *
 * Both panes are *direct* flex items of that row and stretch to its full
 * height, so their bottom edges line up whichever side happens to carry more
 * content - the side that runs long sets the height, the other follows.  The
 * grid spreads the extra height over its two auto-sized rows, which is what
 * brings the cards inside it down to the metadata surface's edge.  Do not wrap
 * either pane in an extra div: the wrapper would stretch, the grid/surface
 * inside it would not, and the bottom edges would drift apart again.
 *
 * The sensor, counter, throughput and offload values come from
 * resources/hardware_status.js.
 *
 * The title is deliberately NOT _('System'): the per-section show/hide state
 * is keyed by the title in localStorage (index.js does
 * includes[i].id = title), so reusing the old title would inherit a "System"
 * section the user had hidden earlier and make this block look like it never
 * rendered.
 *
 * Deviations from the stock file, on top of the render() rewrite:
 *
 *   - 'require hardware_status' added.
 *   - the stock `callTempInfo()` rpc was dropped: on this firmware
 *     `ubus call luci getTempInfo` returns an empty object and its result only
 *     fed the (never taken) `if (tempinfo.tempinfo)` branch, so keeping it
 *     would just burn one rpcd round trip on every poll.
 *   - the "Architecture" value is reduced to the CPU model: luci.getCPUInfo()
 *     on this build returns e.g.
 *     "ARMv8 Processor rev 4 (v8l) x 4 (900MHz, 80.7°C)" (the clock really is
 *     live - ondemand moves it between 500 and 1200 MHz).  The temperature is
 *     owned by the temperature card and the clock by the CPU card, so both are
 *     stripped off the tail instead of showing up twice.
 *
 * Style note: CSS strings are built with plain concatenation, not with
 * String.prototype.format().  That helper only substitutes when the *first*
 * '%' in the format string starts a valid conversion, so a plain "100%" in a
 * style string would silently disable every placeholder behind it.
 *
 * When updating the luci feed, re-check that upstream did not change the stock
 * 10_system.js this file was derived from.
 */

var callGetUnixtime = rpc.declare({
	object: 'luci',
	method: 'getUnixtime',
	expect: { result: 0 }
});

var callLuciVersion = rpc.declare({
	object: 'luci',
	method: 'getVersion'
});

var callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

var callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

var callCPUBench = rpc.declare({
	object: 'luci',
	method: 'getCPUBench'
});

var callCPUInfo = rpc.declare({
	object: 'luci',
	method: 'getCPUInfo'
});

var callCPUUsage = rpc.declare({
	object: 'luci',
	method: 'getCPUUsage'
});

/* Theme variables with literal fallbacks.  The fallbacks are the light values
 * luci-theme-bootstrap actually defines (cascade.css), so if a theme ever
 * fails to define one of them the block still renders with the theme's own
 * palette instead of an unrelated one. */
function css(name, fallback) {
	return 'var(--' + name + ', ' + fallback + ')';
}

var cSurface = css('background-color-high', '#ffffff');
var cCardBg  = css('background-color-medium', '#f9f9f9');
var cBorder  = css('border-color-low', '#eeeeee');
var cTrack   = css('border-color-low', '#eeeeee');
var cLabel   = css('text-color-low', '#bfbfbf');
var cText    = css('text-color-medium', '#808080');
var cStrong  = css('text-color-highest', '#000000');
var cAccent  = css('primary-color-high', '#1976d2');
var cHot     = css('error-color-high', 'rgb(246, 43, 18)');
var cWarm    = css('warn-color-high', '#efbd0b');
var cCool    = css('success-color-high', 'rgb(0, 172, 89)');

/* The metadata grid is a single column: it lives in the narrow right pane,
 * where auto-fit would almost always collapse to one column anyway.
 * The card grid is pinned to two columns so the four cards always read as a
 * 2x2 square in the left pane; the old margin-top is gone because the panes
 * are now separated by the flex container's gap.
 * Neither grid declares grid-template-rows, so both rows stay auto-sized -
 * that is what lets the default align-content: stretch hand the extra height
 * (when this pane is the shorter of the two) down to the cards, so they end
 * flush with the pane beside them instead of floating short. */
var S_INFO_GRID = 'display: grid; grid-template-columns: 1fr; gap: 6px 18px';
var S_CARD_GRID = 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px';
/* min-width: 0 keeps long values (the firmware string) wrapping inside the
 * pane instead of widening it past the flex-basis split. */
var S_SURFACE   = 'min-width: 0; background: ' + cSurface + '; border: 1px solid ' + cBorder + '; border-radius: 6px; padding: 12px 14px';
var S_CARD      = 'background: ' + cCardBg + '; border: 1px solid ' + cBorder + '; border-radius: 6px; padding: 10px 12px; min-width: 0';
var S_CARD_TITLE = 'font-size: 12px; color: ' + cLabel + '; margin-bottom: 8px';
var S_EMPTY     = 'font-size: 13px; color: ' + cLabel;
/* Every card's *leading figure* is set at this one size - the CPU percentage,
 * the TCP/UDP counts, the two temperatures and the uplink rate - so the four
 * cards read as one set.  Only the leading figure is promoted; its unit and any
 * secondary reading (the CPU clock) stay small.  The temperature readings used
 * to tint their figure warm/hot as well, which made them look like a different
 * kind of value, so all figures are plain black now and the warm/hot colour
 * lives only in the temperature bars.  S_BIG_BASE is the colourless half, kept
 * for a card that wants its own colour on the figure. */
var S_BIG_BASE  = 'font-size: 24px; font-weight: 600; line-height: 1.15; font-variant-numeric: tabular-nums';
var S_BIG       = S_BIG_BASE + '; color: ' + cStrong;
var S_UNIT      = 'font-size: 12px; color: ' + cLabel;
var S_NOTE      = 'font-size: 11px; color: ' + cLabel;
var S_TRACK     = 'height: 4px; margin-top: 4px; border-radius: 2px; background: ' + cTrack + '; overflow: hidden';
/* The two *secondary* readings sit one step below S_BIG: the CPU clock next to
 * the big percentage, and the offloaded-flow count behind the TCP/UDP figure.
 * They share this one size on purpose - the counters used to inherit 11px from
 * their caption, which made the same kind of number look like two different
 * ones a card apart. */
var S_SECOND    = '16px';
/* The offloaded-flow count is a good-news reading, so the *number* gets the
 * theme's success colour.  The "硬件卸载" label itself stays in the muted label
 * grey it shares with the other captions - only the value is coloured. */
var S_OFFLOAD     = 'font-size: 11px; color: ' + cLabel;
var S_OFFLOAD_NUM = 'font-size: ' + S_SECOND + '; color: ' + cCool + '; font-weight: 600';
/* The CPU clock is a *secondary* reading sitting next to the big percentage, so
 * it stays one step below S_BIG. */
var S_RATE       = 'font-size: ' + S_SECOND + '; font-weight: 600; font-variant-numeric: tabular-nums; color: ' + cStrong;
var S_RATE_UNIT  = 'font-size: 12px; color: ' + cLabel + '; margin-left: 3px';
/* The muted caption in front of a reading ("上行速率", "TCP"), sized to sit on
 * the baseline of a 24 px figure without drawing attention to itself. */
var S_RATE_LABEL = 'font-size: 12px; color: ' + cLabel;

/* drop null/undefined children - the DOM helper is not relied upon for that */
function kids() {
	var out = [];

	for (var i = 0; i < arguments.length; i++)
		if (arguments[i] != null)
			out.push(arguments[i]);

	return out;
}

/* 0..100 degC is mapped onto 0..100 % of the bar width, 2 % minimum so a cold
 * reading still shows a sliver instead of an empty trough */
function tempBarWidth(millideg) {
	return Math.max(2, Math.min(100, millideg / 1000.0));
}

function tempColor(millideg) {
	if (millideg >= 85000)
		return cHot;

	if (millideg >= 70000)
		return cWarm;

	return cCool;
}

function bar(width, color) {
	return E('div', { 'style': S_TRACK }, [
		E('div', {
			'style': 'height: 100%; border-radius: 2px; background: ' + color +
				'; width: ' + width.toFixed(1) + '%'
		})
	]);
}

function card(title, body) {
	return E('div', { 'style': S_CARD }, [
		E('div', { 'style': S_CARD_TITLE }, [ title ]),
		body
	]);
}

function unavailable() {
	return E('div', { 'style': S_EMPTY }, [ _('不可用') ]);
}

/* `pane` is the flex sizing that turns the surface into the right pane of the
 * two-column row; it is passed in from render() so the layout decision stays
 * visible where the row is built. */
function buildInfo(pairs, pane) {
	var grid = E('div', { 'style': S_INFO_GRID });

	for (var i = 0; i < pairs.length; i++) {
		var label = pairs[i][0], value = pairs[i][1], wide = pairs[i][2];

		grid.appendChild(E('div', {
			'style': 'display: flex; align-items: baseline; gap: 8px; min-width: 0' +
				(wide ? '; grid-column: 1 / -1' : '')
		}, [
			E('span', {
				'style': 'flex: 0 0 auto; min-width: 5em; font-size: 12px; color: ' + cLabel
			}, [ label ]),
			E('span', {
				'style': 'flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; color: ' + cStrong
			}, [ (value != null) ? value : '?' ])
		]));
	}

	return E('div', { 'style': (pane ? pane + '; ' : '') + S_SURFACE }, [ grid ]);
}

function buildTemps(hw) {
	var temps = hw.temps || [];

	if (!temps.length)
		return unavailable();

	return E('div', {}, temps.map(function(t, i) {
		var color = tempColor(t.value);

		return E('div', {
			'style': 'margin-bottom: ' + ((i < temps.length - 1) ? '8px' : '0')
		}, [
			E('div', { 'style': 'display: flex; align-items: baseline; justify-content: space-between; gap: 8px' }, [
				E('span', { 'style': 'font-size: 13px; color: ' + cText }, [ t.label ]),
				E('span', { 'style': S_BIG }, [
					(t.value / 1000.0).toFixed(1),
					E('span', { 'style': 'font-size: 12px; font-weight: 400; margin-left: 2px' }, [ '°C' ])
				])
			]),
			bar(tempBarWidth(t.value), color)
		]);
	}));
}

function buildUsage(hw, freq) {
	if (hw.cpuusage == null)
		return unavailable();

	/* Consecutive polls are L.env.pollinterval seconds apart, so the delta is
	 * measured over that window.  The very first render uses a 500 ms window
	 * instead, see hardware_status.js. */
	var window = (+L.env.pollinterval) || 5;

	return E('div', {}, [
		E('div', { 'style': 'display: flex; align-items: baseline; justify-content: space-between; gap: 8px' }, kids(
			E('span', { 'style': 'display: flex; align-items: baseline; gap: 2px' }, [
				E('span', { 'style': S_BIG }, [ hw.cpuusage.toFixed(1) ]),
				E('span', { 'style': S_UNIT }, [ '%' ])
			]),
			freq != null ? E('span', {}, [
				E('span', { 'style': S_RATE }, [ freq ]),
				E('span', { 'style': S_RATE_UNIT }, [ 'MHz' ])
			]) : null
		)),
		bar(Math.max(2, Math.min(100, hw.cpuusage)), cAccent),
		E('div', { 'style': S_NOTE + '; margin-top: 6px' }, [ window + ' 秒采样窗口' ])
	]);
}

/* One throughput line: the direction spelled out on the left, the right aligned
 * reading with its unit on the other side.  The interface itself is never
 * named - the card is understood to be the uplink, and the caption conveys the
 * direction. */
function rateLine(label, value, spaced) {
	return E('div', {
		'style': 'display: flex; align-items: baseline; justify-content: space-between; gap: 8px' +
			(spaced ? '; margin-bottom: 6px' : '')
	}, [
		E('span', { 'style': S_RATE_LABEL }, [ label ]),
		E('span', {}, [
			E('span', { 'style': S_BIG }, [ value.toFixed(2) ]),
			E('span', { 'style': S_RATE_UNIT }, [ 'Mibit/s' ])
		])
	]);
}

function buildRate(hw) {
	var rate = hw.netrate;

	if (!rate)
		return unavailable();

	/* Consecutive polls are L.env.pollinterval seconds apart, so each reading is
	 * an average over that window (the very first one uses 500 ms, see
	 * hardware_status.js). */
	var window = (+L.env.pollinterval) || 5;

	/* Uplink first, then downlink - the order the user asked for. */
	return E('div', {}, [
		rateLine(_('上行速率'), rate.tx, true),
		rateLine(_('下行速率'), rate.rx, false),
		E('div', { 'style': S_NOTE + '; margin-top: 6px' }, [ window + ' 秒平均' ])
	]);
}

function buildConns(hw) {
	var rows = [];

	function row(label, c) {
		if (!c)
			return;

		/* The offload counter is only meaningful once the PPE is actually
		 * attached; while it is not, a per-row "硬件卸载 0" would read like a
		 * fault instead of "this is off". */
		var sub = null;

		if (hw.npuAttached > 0)
			sub = E('span', { 'style': S_OFFLOAD }, [
				_('硬件卸载') + ' ',
				E('span', { 'style': S_OFFLOAD_NUM }, [ String(c.npu) ])
			]);

		rows.push(E('div', {
			'style': 'display: flex; align-items: baseline; gap: 8px; margin-bottom: ' + (rows.length ? '0' : '8px')
		}, kids(
			E('span', { 'style': 'flex: 0 0 auto; min-width: 2.8em; font-size: 12px; color: ' + cText }, [ label ]),
			E('span', { 'style': S_BIG }, [ String(c.total) ]),
			sub
		)));
	}

	row('TCP', hw.tcp);
	row('UDP', hw.udp);

	if (!rows.length)
		return unavailable();

	/* npuAttached === 0 does NOT mean offload is disabled. The driver attaches
	 * the NPU lazily -- on the first flow that really gets hardware-offloaded
	 * (airoha_ppe_setup_tc_block_cb() -> airoha_ppe_offload_setup(), reached via
	 * TC_SETUP_CLSFLOWER). Until that happens the value is always 0, so report
	 * "standing by / no offloaded flow yet" instead of something that reads
	 * like a fault. Verified on the device 2026-09-27: it stays 0 with no
	 * uplink and flips to 1 within seconds of the first forwarded flow. */
	if (hw.npuAttached === 0)
		rows.push(E('div', { 'style': S_NOTE + '; margin-top: 6px' }, [ _('硬件卸载待命（暂无卸载流）') ]));

	return E('div', {}, rows);
}

return baseclass.extend({
	title: _('硬件监控'),

	load: function() {
		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callCPUBench(), {}),
			L.resolveDefault(callCPUInfo(), {}),
			L.resolveDefault(callCPUUsage(), {}),
			L.resolveDefault(callLuciVersion(), { revision: _('unknown version'), branch: 'LuCI' }),
			L.resolveDefault(callGetUnixtime(), 0),
			uci.load('system'),
			hardware_status.read()
		]);
	},

	render: function(data) {
		var boardinfo   = data[0],
		    systeminfo  = data[1],
		    cpubench    = data[2],
		    cpuinfo     = data[3],
		    cpuusage    = data[4],
		    luciversion = data[5],
		    unixtime    = data[6],
		    hw          = data[8] || {};

		luciversion = luciversion.branch + ' ' + luciversion.revision;

		var datestr = null;

		if (unixtime) {
			var date = new Date(unixtime * 1000),
				zn = uci.get('system', '@system[0]', 'zonename')?.replaceAll(' ', '_') || 'UTC',
				ts = uci.get('system', '@system[0]', 'clock_timestyle') || 0,
				hc = uci.get('system', '@system[0]', 'clock_hourcycle') || 0;

			datestr = new Intl.DateTimeFormat(undefined, {
				dateStyle: 'medium',
				timeStyle: (ts == 0) ? 'long' : 'full',
				hourCycle: (hc == 0) ? undefined : hc,
				timeZone: zn
			}).format(date);
		}

		/* "ARMv8 Processor rev 4 (v8l) x 4 (900MHz, 80.7°C)" -> keep just the CPU
		 * model.  The clock part is a live reading (ondemand moves it between 500
		 * and 1200 MHz), so it is handed to the CPU card rather than frozen into
		 * the architecture string, and the temperature is owned by the
		 * temperature card.
		 * (An earlier "\\([^()]*°C\\)" pattern ate the whole "(900MHz, 80.7°C)"
		 * group - do not go back to that.) */
		var cpuraw = cpuinfo.cpuinfo || boardinfo.system || '';
		var cpufreq = (cpuraw.match(/([0-9.]+)\s*MHz/) || [])[1];
		var arch = cpuraw
			.replace(/,\s*[0-9.]+\s*\u00b0C(?=\s*\))/, '')
			.replace(/\s*\(\s*[0-9.]+\s*MHz\s*\)\s*$/, '')
			.replace(/\s*\(\s*[0-9.]+\s*\u00b0C\s*\)\s*$/, '');

		var info = [
			[ _('主机名'),   boardinfo.hostname ],
			[ _('型号'),     boardinfo.model + cpubench.cpubench ],
			[ _('架构'),     arch ],
			[ _('目标平台'), (L.isObject(boardinfo.release) ? boardinfo.release.target : '') ],
			[ _('内核版本'), boardinfo.kernel ],
			[ _('运行时间'), systeminfo.uptime ? '%t'.format(systeminfo.uptime) : null ],
			[ _('平均负载'), Array.isArray(systeminfo.load) ? '%.2f, %.2f, %.2f'.format(
				systeminfo.load[0] / 65535.0,
				systeminfo.load[1] / 65535.0,
				systeminfo.load[2] / 65535.0
			) : null ],
			[ _('本地时间'), datestr ],
			[ _('固件版本'), (L.isObject(boardinfo.release) ? boardinfo.release.description + ' / ' : '') + (luciversion || ''), true ]
		];

		/* Both panes are the grids themselves - not wrappers around them - so
		 * that align-items: stretch on the row below hands them the full row
		 * height and the cards/surface inside can fill it.  A wrapper would
		 * take the stretch while the grid inside stayed at its content
		 * height, which is exactly the "one side stops short" look this
		 * layout is meant to avoid. */
		var paneCards = E('div', { 'style': 'flex: 3 1 360px; min-width: 0; ' + S_CARD_GRID }, [
			card(_('温度'),        buildTemps(hw)),
			card(_('CPU 占用率'),  buildUsage(hw, cpufreq)),
			card(_('Pon 端口速率'),  buildRate(hw)),
			card(_('连接数'),      buildConns(hw))
		]);

		/* Left pane: the four cards as a 2x2 grid.  Right pane: the metadata
		 * surface.  flex-grow 3 vs 2 is the 3:2 split the user asked for;
		 * flex-wrap puts the panes on separate rows when the viewport gets
		 * too narrow to give both their min width.  align-items: stretch is
		 * the default and is stated here because it is load-bearing: the
		 * taller pane sets the row height and the shorter one grows to match,
		 * keeping the two bottom edges parallel. */
		var paneInfo = buildInfo(info, 'flex: 2 1 260px');

		return E('div', {
			'style': 'display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch'
		}, [ paneCards, paneInfo ]);
	}
});
