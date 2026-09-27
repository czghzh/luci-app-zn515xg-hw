'use strict';
'require baseclass';
'require fs';

/*
 * ZNXT ZN515XG-D - hardware status helpers for the LuCI overview page.
 *
 * Consumed by view/status/include/15_hw.js (the luci-app-zn515xg-hw package),
 * which renders the values as metric cards below the metadata grid.
 * Everything is read
 * through the regular rpcd file API; none of the vendor's patched rpcd
 * methods (luci.getTempInfo etc.) are involved - getTempInfo returns an empty
 * object on this firmware, hence the straight sensor reads below.
 *
 *   temperature    /sys/class/thermal/thermal_zone0/temp        (millidegrees)
 *                  /sys/class/hwmon/hwmonN/temp1_input          (wireless radio,
 *                  N is probed - see WIFI_HWMON_NAME below)
 *   CPU usage      /proc/stat, delta between two samples
 *   connections    /usr/sbin/515xg-connstat                     (helper script;
 *                  its source /proc/net/nf_conntrack is a pseudo file with
 *                  st_size 0 and rpcd's file.read returns at most 4096 bytes
 *                  for such files, so a helper is required here)
 *   up/down rate   same helper - it also reports the pon0 octet counters, so
 *                  the rate is a delta between two polls, like the CPU usage.
 *                  Reported in Mibit/s (1024*1024 bit/s)
 *   offload state  /sys/kernel/debug/ppe/config                 (npu_attached)
 *
 * The optical front-end (EN7572) DDMI temperature in
 * /sys/kernel/debug/airoha-xpon-pon0/frontend is deliberately *not* read: the
 * user asked for the temperature card to carry CPU + WiFi only, and an unread
 * sensor is one less rpcd round trip per poll.  The ACL still grants read on
 * that file so `ubus call file read` stays usable for manual checks.  The value
 * is a signed 8.8 fixed point number (1/256 degC per count, below 0 degC wraps
 * into the upper half of the 16 bit field), i.e. Math.round(v * 1000 / 256).
 *
 * Access to these paths is granted by
 * /usr/share/rpcd/acl.d/luci-status-hardware.json.
 *
 * Note: like every LuCI module this one has to return a class (the loader
 * rejects plain objects); values are read through the returned instance.
 */

var CPU_TEMP     = '/sys/class/thermal/thermal_zone0/temp';
var PPE_CONFIG   = '/sys/kernel/debug/ppe/config';
var CONNSTAT     = '/usr/sbin/515xg-connstat';

/*
 * The wireless radios export their temperature through hwmon; the 2.4 GHz one
 * registers as "mt7915_phy0" (the 5 GHz one as "mt7915_phy1", which this page
 * does not show).  hwmon numbering is assigned dynamically and is not stable
 * across reboots, so probe a few slots and match by name rather than
 * hardcoding an index.  Probing stops at the first match: the overview page
 * re-reads this on every pollinterval and every probe costs an rpcd round trip.
 */
var WIFI_HWMON_NAME = 'mt7915_phy0';
var WIFI_HWMON_MAX  = 3;

/* previous /proc/stat sample, kept between polls */
var prevStat = null;

/* previous optical uplink octet sample, kept between polls */
var prevNet = null;

function readCpuTemp() {
	return fs.trimmed(CPU_TEMP).then(function(s) {
		var v = parseInt(s);

		return isNaN(v) ? null : v;
	});
}

function readWifiTemp() {
	function probe(idx) {
		if (idx > WIFI_HWMON_MAX)
			return Promise.resolve(null);

		var base = '/sys/class/hwmon/hwmon' + idx;

		return fs.trimmed(base + '/name').then(function(name) {
			if (name != WIFI_HWMON_NAME)
				return probe(idx + 1);

			return fs.trimmed(base + '/temp1_input').then(function(s) {
				var v = parseInt(s);

				return isNaN(v) ? null : v;
			});
		});
	}

	return probe(0);
}

/* 1 = PPE attached (hardware offload usable), 0 = not attached, null = unknown */
function readNpuAttached() {
	return fs.trimmed(PPE_CONFIG).then(function(s) {
		var m = s.match(/^npu_attached:\s*(\d+)\s*$/m);

		return m ? parseInt(m[1]) : null;
	});
}

function statSample() {
	return fs.trimmed('/proc/stat').then(function(s) {
		var m = s.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);

		if (!m)
			return null;

		var v = m.slice(1).map(Number);

		return {
			idle: v[3] + v[4],
			total: v.reduce(function(a, b) { return a + b; }, 0)
		};
	});
}

function statUsage() {
	function usage(from, to) {
		var delta = to.total - from.total;
		var idle = to.idle - from.idle;

		if (delta <= 0)
			return 0;

		return Math.max(0, Math.min(100, 100 * (delta - idle) / delta));
	}

	return statSample().then(function(s) {
		if (!s)
			return null;

		var ret = (prevStat != null) ? usage(prevStat, s) : null;

		prevStat = s;

		if (ret != null)
			return ret;

		/* first poll only: take a short second sample so the initial render
		 * already shows something meaningful instead of a dash.  Not repeated
		 * on later polls - prevStat is cached from now on. */
		return new Promise(function(resolve) {
			window.setTimeout(function() {
				statSample().then(function(s2) {
					if (s2) {
						prevStat = s2;
						resolve(usage(s, s2));
					}
					else {
						resolve(null);
					}
				});
			}, 500);
		});
	});
}

/* One exec of the helper, parsed into a plain key -> number map.  Both the
 * connection counters and the uplink octet counters come out of this single
 * call, so the awk pass over nf_conntrack is paid for only once per poll. */
function readRaw() {
	return L.resolveDefault(fs.exec(CONNSTAT), {}).then(function(res) {
		var vals = {};
		var lines = ((res && res.stdout) || '').split('\n');

		for (var i = 0; i < lines.length; i++) {
			var m = lines[i].match(/^([a-z0-9_]+)=(\d+)$/);

			if (m)
				vals[m[1]] = parseInt(m[2]);
		}

		return vals;
	});
}

/* Connection counters + uplink rate, from a single helper exec.
 *
 * The helper reports absolute octet counters of the optical uplink, so the rate
 * is the delta between two polls over the elapsed wall clock time - the same
 * scheme statUsage() uses above.  The interface is not configurable here on
 * purpose: the helper decides which one it reports, and the page never shows
 * its name.
 *
 * First poll: take a second sample 500 ms later so the card is already
 * populated on the initial render instead of showing a dash for a whole
 * pollinterval.  That costs one extra helper exec per page load, and nothing
 * afterwards. */
function readNet() {
	function counters(vals) {
		function pair(total, npu) {
			return (typeof(total) == 'number' && typeof(npu) == 'number')
				? { total: total, npu: npu } : null;
		}

		return { tcp: pair(vals.tcp_total, vals.tcp_npu),
		         udp: pair(vals.udp_total, vals.udp_npu) };
	}

	/* null when the helper did not report the octet counters (interface gone) */
	function sample(vals, t) {
		if (typeof(vals.pon_rx_bytes) != 'number' || typeof(vals.pon_tx_bytes) != 'number')
			return null;

		return { rx: vals.pon_rx_bytes, tx: vals.pon_tx_bytes, t: t };
	}

	/* counter wrap / restart would otherwise produce a huge bogus spike */
	function rate(from, to) {
		var dt = (to.t - from.t) / 1000.0;

		if (dt <= 0 || to.rx < from.rx || to.tx < from.tx)
			return null;

		return {
			rx: (to.rx - from.rx) * 8 / 1048576 / dt,
			tx: (to.tx - from.tx) * 8 / 1048576 / dt
		};
	}

	return readRaw().then(function(vals) {
		var c = counters(vals);
		var cur = sample(vals, Date.now());

		if (cur != null) {
			var r = (prevNet != null) ? rate(prevNet, cur) : null;

			prevNet = cur;

			if (r != null)
				return { counters: c, rate: r };
		}
		else {
			/* no octet counters at all - nothing to sample later either */
			return { counters: c, rate: null };
		}

		return new Promise(function(resolve) {
			window.setTimeout(function() {
				readRaw().then(function(vals2) {
					var cur2 = sample(vals2, Date.now());

					if (cur2 == null) {
						resolve({ counters: c, rate: null });
						return;
					}

					prevNet = cur2;
					resolve({ counters: c, rate: rate(cur, cur2) });
				});
			}, 500);
		});
	});
}

return baseclass.extend({
	/*
	 * Returns:
	 *
	 *   temps        [ { key, label, value } ... ] - value in millidegrees C,
	 *                unavailable sensors are omitted from the array
	 *   cpuusage     percent as a plain number (0..100) or null
	 *   tcp / udp    { total, npu } or null
	 *   netrate      { rx, tx } in Mibit/s or null
	 *   npuAttached  1 / 0 / null
	 *
	 * Any of them may be null when the corresponding source is unavailable.
	 */
	read: function() {
		return Promise.all([
			readCpuTemp(),
			readWifiTemp(),
			statUsage(),
			readNet(),
			readNpuAttached()
		]).then(function(r) {
			var defs = [
				{ key: 'cpu',  label: 'CPU',  value: r[0] },
				{ key: 'wifi', label: 'WiFi', value: r[1] }
			], temps = [];

			for (var i = 0; i < defs.length; i++)
				if (defs[i].value != null)
					temps.push(defs[i]);

			return {
				temps: temps,
				cpuusage: (r[2] != null) ? r[2] : null,
				tcp: r[3] ? r[3].counters.tcp : null,
				udp: r[3] ? r[3].counters.udp : null,
				netrate: r[3] ? r[3].rate : null,
				npuAttached: r[4]
			};
		});
	}
});
