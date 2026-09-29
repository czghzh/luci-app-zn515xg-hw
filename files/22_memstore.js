'use strict';
'require baseclass';
'require rpc';

/*
 * ZNXT ZN515XG-D: the "内存与储存" block for Status -> Overview.
 *
 * The stock luci-mod-status page ships two separate blocks there - "Memory"
 * (20_memory.js) and "Storage" (25_storage.js) - which stack vertically.  This
 * file merges them into a single section whose two cards sit side by side, and
 * restyles them as cards so they match the neighbouring "硬件监控" block
 * (this package's own 15_hw.js).
 *
 * It is shipped under a *new* file name, view/status/include/22_memstore.js.
 * The overview page discovers its includes by scanning that directory at
 * runtime and sorting by file name (index.js: fs.list() -> filter *.js ->
 * sort -> L.require()), so "22_" lands exactly where the stock 20_/25_ pair
 * used to sit and the package never claims a path owned by luci-mod-status -
 * which is what keeps it installable with a plain `apk add`.  The stock pair
 * is taken out of the scan by this package's postinst (renamed to
 * *.js.disabled) and put back by postrm, the same mechanism 15_hw.js uses for
 * the stock 10_system.js block.
 *
 * The title is deliberately NOT _('Memory') or _('Storage'): the per-section
 * show/hide state is keyed by the title in localStorage (index.js does
 * includes[i].id = title), so reusing either name would inherit a section the
 * user had hidden earlier and make this block look like it never rendered.
 *
 * Data comes from the same rpcd calls the stock blocks used:
 *
 *   system.info          memory.{total,free,buffered,cached,available}, swap,
 *                        and the root / tmp file system usage (in KB)
 *   luci.getMountPoints  the remaining mount points listed in the storage card
 *
 * Both are already granted by the luci-mod-status-index ACL group, so this
 * package needs no ACL entry of its own for them.
 *
 * Units: system.info reports memory in bytes but the root/tmp file systems in
 * KB (the stock block multiplied those by 1024); luci.getMountPoints reports
 * size/free in bytes.  Both are normalised to bytes here and rendered by
 * fmtBytes().
 *
 * Style note: like 15_hw.js, CSS strings are built with plain concatenation
 * and never with String.prototype.format() - that helper only substitutes when
 * the *first* '%' starts a valid conversion, so a bare "100%" inside a style
 * string would silently disable every placeholder behind it.
 */

/* theme variables with literal fallbacks, same set as 15_hw.js */
function css(name, fallback) {
	return 'var(--' + name + ', ' + fallback + ')';
}

var cCardBg = css('background-color-medium', '#f9f9f9');
var cBorder = css('border-color-low', '#eeeeee');
var cTrack  = css('border-color-low', '#eeeeee');
var cLabel  = css('text-color-low', '#bfbfbf');
var cText   = css('text-color-medium', '#808080');
var cStrong = css('text-color-highest', '#000000');
var cAccent = css('primary-color-high', '#1976d2');

/* No align-items: flex-start here.  With flex-start each card stops at its own
 * content height, and the memory card normally carries one row more than the
 * storage card (storage only ever gains a row when a mount escapes
 * MountSkipList), so the storage card visibly stopped short of the memory one.
 * The default, stretch, makes both cards fill the row, so their bottom edges
 * line up whichever side is longer. */
var S_GRID     = 'display: flex; flex-wrap: wrap; gap: 12px';
var S_CARD     = 'flex: 1 1 260px; min-width: 0; background: ' + cCardBg +
                 '; border: 1px solid ' + cBorder + '; border-radius: 6px; padding: 10px 12px';
var S_CARD_TITLE = 'font-size: 12px; color: ' + cLabel + '; margin-bottom: 8px';
var S_BIG      = 'font-size: 24px; font-weight: 600; line-height: 1.15; font-variant-numeric: tabular-nums; color: ' + cStrong;
var S_BIG_UNIT = 'font-size: 12px; color: ' + cLabel;
var S_ROWS     = 'display: grid; gap: 8px; margin-top: 10px';
var S_ROW_LABEL = 'font-size: 12px; color: ' + cText;
var S_ROW_VALUE = 'font-size: 11px; color: ' + cLabel + '; font-variant-numeric: tabular-nums';
var S_TRACK    = 'height: 4px; margin-top: 4px; border-radius: 2px; background: ' + cTrack + '; overflow: hidden';

/* The stock storage block skipped these: the root file system and the overlay
 * are already covered by the Disk space row, /tmp by the Temp space row. */
var MountSkipList = [ '/rom', '/tmp', '/dev', '/overlay', '/' ];

/* bytes -> "12.34 MiB", 1024 based.  Hand rolled instead of using LuCI's
 * String.format('%1024.2mB', ...) so the module has no dependency on the
 * format extension and stays testable outside the browser. */
function fmtBytes(v) {
	var n = Number(v);

	if (!isFinite(n) || n < 0)
		return '?';

	var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;

	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}

	return n.toFixed(i ? 2 : 0) + ' ' + units[i];
}

function bar(percent, color) {
	return E('div', { 'style': S_TRACK }, [
		E('div', {
			'style': 'height: 100%; border-radius: 2px; background: ' + color +
				'; width: ' + Math.max(0, Math.min(100, percent)).toFixed(1) + '%'
		})
	]);
}

/* One usage line: caption and reading on top, a slim bar below.  With no
 * usable size the row degrades to "?" instead of drawing a bogus bar. */
function usageRow(label, used, size) {
	var u = Number(used), s = Number(size),
	    ok = isFinite(u) && u >= 0 && isFinite(s) && s > 0;

	return E('div', {}, [
		E('div', { 'style': 'display: flex; align-items: baseline; justify-content: space-between; gap: 8px' }, [
			E('span', { 'style': S_ROW_LABEL }, [ label ]),
			E('span', { 'style': S_ROW_VALUE }, [ ok ? (fmtBytes(u) + ' / ' + fmtBytes(s)) : '?' ])
		]),
		bar(ok ? (u / s) * 100 : 0, cAccent)
	]);
}

function card(title, big, bigUnit, rows) {
	return E('div', { 'style': S_CARD }, [
		E('div', { 'style': S_CARD_TITLE }, [ title ]),
		E('div', {}, [
			E('span', { 'style': S_BIG }, [ big ]),
			E('span', { 'style': S_BIG_UNIT }, [ bigUnit ])
		]),
		E('div', { 'style': S_ROWS }, rows)
	]);
}

var callSystemInfo = rpc.declare({
	object: 'system',
	method: 'info'
});

var callMountPoints = rpc.declare({
	object: 'luci',
	method: 'getMountPoints',
	expect: { result: [] }
});

return baseclass.extend({
	title: _('内存与储存'),

	load: function() {
		return Promise.all([
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callMountPoints(), [])
		]);
	},

	render: function(data) {
		var systeminfo = (data && data[0]) || {},
		    mounts = (data && Array.isArray(data[1])) ? data[1] : [],
		    mem  = L.isObject(systeminfo.memory) ? systeminfo.memory : {},
		    swap = L.isObject(systeminfo.swap) ? systeminfo.swap : {},
		    root = L.isObject(systeminfo.root) ? systeminfo.root : {},
		    tmp  = L.isObject(systeminfo.tmp) ? systeminfo.tmp : {};

		/* ---- memory card ---------------------------------------------- */

		var memRows = [],
		    /* total available - the stock fallback chain, kept verbatim */
		    avail = (mem.available) ? mem.available
		          : (mem.total && mem.free && mem.buffered) ? mem.free + mem.buffered : null,
		    memUsed = (mem.total && mem.free) ? (mem.total - mem.free) : null;

		if (avail != null)
			memRows.push(usageRow(_('Total Available'), avail, mem.total));

		if (memUsed != null)
			memRows.push(usageRow(_('Used'), memUsed, mem.total));

		if (mem.buffered)
			memRows.push(usageRow(_('Buffered'), mem.buffered, mem.total));

		if (mem.cached)
			memRows.push(usageRow(_('Cached'), mem.cached, mem.total));

		if (swap.total > 0)
			memRows.push(usageRow(_('Swap free'), swap.free, swap.total));

		if (!memRows.length)
			memRows.push(E('div', { 'style': 'font-size: 13px; color: ' + cLabel }, [ _('不可用') ]));

		var memPct = (memUsed != null && mem.total > 0)
			? Math.round(memUsed / mem.total * 100) : null;

		/* ---- storage card --------------------------------------------- */

		var stRows = [];

		stRows.push(usageRow(_('Disk space'), root.used * 1024, root.total * 1024));
		stRows.push(usageRow(_('Temp space'), tmp.used * 1024, tmp.total * 1024));

		for (var i = 0; i < mounts.length; i++) {
			var entry = mounts[i];

			if (!entry || MountSkipList.indexOf(entry.mount) !== -1)
				continue;

			stRows.push(usageRow(entry.device + ' (' + entry.mount + ')',
				entry.size - entry.free, entry.size));
		}

		var rootPct = (root.total > 0) ? Math.round(root.used / root.total * 100) : null;

		return E('div', { 'style': S_GRID }, [
			card(_('内存'), (memPct != null) ? String(memPct) : '?', '%', memRows),
			card(_('储存'), (rootPct != null) ? String(rootPct) : '?', '%', stRows)
		]);
	}
});
