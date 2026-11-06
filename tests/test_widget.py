"""month_ahead: joining calendar_month and weather_forecast into the wall calendar's payload,
event times in the app's zone, bin nights, the sample flag, and fetch() through a fake plugin
registry. No network."""

from __future__ import annotations

import importlib.util
import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from flask import Flask

ROOT = Path(__file__).resolve().parents[1]


def _load():
    name = "_tesserae_plugins.month_ahead.server"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, ROOT / "server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


server = _load()
MELB = ZoneInfo("Australia/Melbourne")
START = date(2026, 11, 1)  # a Sunday


def cal_payload(events_by_index=None, today_index=5, weeks=5):
    events_by_index = events_by_index or {}
    days = []
    for i in range(weeks * 7):
        d = START + timedelta(days=i)
        days.append(
            {
                "date": d.isoformat(),
                "day": d.day,
                "is_today": i == today_index,
                "events": events_by_index.get(i, []),
                "extra": 0,
            }
        )
    return {"days": days}


WX = {
    "place": "Melbourne",
    "days": [
        {"date": "2026-11-06", "code": 53, "cond": "Drizzle", "hi": 21, "lo": 10, "rain": 53},
        {"date": "2026-11-07", "code": 80, "cond": "Showers", "hi": 13, "lo": 9, "rain": 100},
        {"date": "2026-11-08", "code": 3, "cond": "Overcast", "hi": 15, "lo": 10, "rain": 37},
        {"date": "2026-11-09", "code": 0, "cond": "Clear", "hi": 20, "lo": 5, "rain": 0},
        {"date": "2026-11-10", "code": 2, "cond": "Partly", "hi": 26, "lo": 10, "rain": 5},
    ],
}


# ------------------------------------------------------------------ small pieces


@pytest.mark.parametrize(
    "h,m,want",
    [(0, 0, "12a"), (9, 0, "9a"), (12, 0, "12p"), (18, 30, "6:30p"), (8, 15, "8:15a")],
)
def test_clock(h, m, want):
    from datetime import datetime

    assert server.clock(datetime(2026, 1, 1, h, m)) == want


def test_event_time_is_written_in_the_app_zone():
    # 07:30 UTC is 6:30pm in Melbourne in November (AEDT, +11).
    assert server.event_time("2026-11-06T07:30:00+00:00", MELB) == "6:30p"
    assert server.event_time("2026-11-06T07:30:00Z", MELB) == "6:30p"
    assert server.event_time("not a date", MELB) == ""


def test_bins_weekly_and_fortnightly():
    wed = date(2026, 11, 4)
    assert server.bins_for(wed, "", "weekly", None) == []
    assert server.bins_for(wed, "5", "weekly", None) == []  # Friday only
    assert server.bins_for(wed, "3", "none", None) == ["trash"]
    assert server.bins_for(wed, "3", "weekly", None) == ["trash", "recycle"]
    assert server.bins_for(wed, "3", "fortnightly", wed) == ["trash", "recycle"]
    assert server.bins_for(wed + timedelta(days=7), "3", "fortnightly", wed) == ["trash"]
    assert server.bins_for(wed + timedelta(days=14), "3", "fortnightly", wed) == [
        "trash",
        "recycle",
    ]
    # An anchor in the future still splits the fortnights the same way.
    assert server.bins_for(wed, "3", "fortnightly", wed + timedelta(days=14)) == [
        "trash",
        "recycle",
    ]
    assert server.bins_for(wed, "3", "fortnightly", wed + timedelta(days=7)) == ["trash"]
    # Sunday is 0, as in JavaScript.
    assert server.bins_for(date(2026, 11, 1), "0", "none", None) == ["trash"]


# ------------------------------------------------------------------ build()


def test_build_joins_weather_bins_and_times():
    events = {
        5: [
            {
                "summary": "Pizza",
                "start": "2026-11-06T07:00:00+00:00",
                "all_day": False,
                "colour": "#4F6A92",
            },
            {"summary": "Away", "start": "2026-11-06", "all_day": True, "continued": True},
        ]
    }
    out = server.build(
        cal_payload(events),
        WX,
        {
            "bin_day": "3",
            "recycling": "fortnightly",
            "recycling_from": "2026-11-04",
            "theme": "paper",
        },
        zone=MELB,
    )
    days = out["days"]
    assert len(days) == 35
    assert out["today"] == 5
    today = days[5]
    assert today["weekday"] == 5
    assert today["wx"]["hi"] == 21 and today["wx"]["cond"] == "Drizzle"
    assert today["events"][0] == {
        "summary": "Pizza",
        "time": "6p",
        "all_day": False,
        "continued": False,
        "colour": "#4F6A92",
    }
    assert today["events"][1]["time"] == "" and today["events"][1]["continued"] is True
    # Only the forecast days carry weather; later days have none.
    assert days[20]["wx"] is None
    # Bins: Wednesday 4 Nov with recycling, 11 Nov without, 18 Nov with.
    assert days[3]["bins"] == ["trash", "recycle"]
    assert days[10]["bins"] == ["trash"]
    assert days[17]["bins"] == ["trash", "recycle"]
    assert days[4]["bins"] == []
    # The four days after today, for the today panel's strip.
    assert [f["date"] for f in out["ahead"]] == [
        "2026-11-07",
        "2026-11-08",
        "2026-11-09",
        "2026-11-10",
    ]
    assert out["look"] == {"theme": "paper", "colour": True, "sidebar": True}
    assert out["place"] == "Melbourne"


def test_build_look_defaults_and_guards():
    out = server.build(cal_payload(), {}, {"theme": "nonsense", "colour": "mono", "sidebar": False})
    assert out["look"] == {"theme": "noir", "colour": False, "sidebar": False}
    assert out["ahead"] == []
    assert all(d["wx"] is None for d in out["days"])


def test_fortnight_counts_from_first_bin_night_when_no_date_given():
    out = server.build(cal_payload(), {}, {"bin_day": "3", "recycling": "fortnightly"})
    weds = [d["bins"] for d in out["days"] if d["weekday"] == 3]
    assert weds == [
        ["trash", "recycle"],
        ["trash"],
        ["trash", "recycle"],
        ["trash"],
        ["trash", "recycle"],
    ]


# ------------------------------------------------------------------ fetch()


class Registry(dict):
    def get(self, key, default=None):
        return super().get(key, default)


def _registry(tmp_path, *, feeds, cal=None, calls=None):
    calls = calls if calls is not None else {}

    def cal_fetch(options, settings, *, ctx):
        calls["cal"] = options
        return cal or cal_payload()

    def wx_fetch(options, settings, *, ctx):
        calls["wx"] = (options, ctx["data_dir"])
        return WX

    return Registry(
        calendar_month=SimpleNamespace(
            server_module=SimpleNamespace(fetch=cal_fetch), data_dir=tmp_path / "cm"
        ),
        weather_forecast=SimpleNamespace(
            server_module=SimpleNamespace(fetch=wx_fetch), data_dir=tmp_path / "wx"
        ),
        calendar_core=SimpleNamespace(
            server_module=SimpleNamespace(_load_feeds=lambda dd: {"feeds": feeds}),
            data_dir=tmp_path / "cc",
        ),
    )


def _fetch(registry, options):
    app = Flask(__name__)
    app.config["PLUGIN_REGISTRY"] = registry
    with app.app_context():
        return server.fetch(options, {}, ctx={"data_dir": "/tmp/ma"})


def test_fetch_passes_options_through(tmp_path):
    calls = {}
    out = _fetch(
        _registry(tmp_path, feeds=[{"id": "a"}], calls=calls),
        {
            "weeks": "6",
            "week_start": "sunday",
            "max_events_per_day": "3",
            "feeds_filter": "a,b",
            "latitude": -37.8,
            "longitude": 144.9,
            "units": "imperial",
        },
    )
    assert calls["cal"] == {
        "rolling_weeks": "6",
        "week_start": "sunday",
        "max_events_per_day": 3,
        "feeds_filter": "a,b",
    }
    wx_opts, wx_dir = calls["wx"]
    assert wx_opts["units"] == "imperial" and wx_opts["latitude"] == -37.8
    assert wx_dir == str(tmp_path / "wx")  # the forecast caches in its own folder
    # Feeds are set up, so an empty month is a real empty month, not a sample.
    assert out["sample"] is False


def test_fetch_without_location_skips_weather(tmp_path):
    calls = {}
    out = _fetch(_registry(tmp_path, feeds=[{"id": "a"}], calls=calls), {})
    assert "wx" not in calls
    assert out["ahead"] == []
    assert calls["cal"]["rolling_weeks"] == "5" and calls["cal"]["week_start"] == "monday"


def test_fetch_is_a_sample_only_without_feeds(tmp_path):
    assert _fetch(_registry(tmp_path, feeds=[]), {})["sample"] is True
    assert _fetch(_registry(tmp_path, feeds=[{"id": "a", "enabled": False}]), {})["sample"] is True
    busy = cal_payload({2: [{"summary": "x", "start": "2026-11-03", "all_day": True}]})
    assert _fetch(_registry(tmp_path, feeds=[], cal=busy), {})["sample"] is False


def test_fetch_without_calendar_widget(tmp_path):
    reg = _registry(tmp_path, feeds=[])
    del reg["calendar_month"]
    out = _fetch(reg, {})
    assert out["days"] == [] and "isn't installed" in out["error"]
