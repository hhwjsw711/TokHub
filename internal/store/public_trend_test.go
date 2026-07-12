package store

import (
	"strings"
	"testing"
)

func TestNormalizePublicChannelRange(t *testing.T) {
	tests := []struct {
		name       string
		value      string
		active     bool
		hourly     bool
		all        bool
		days       int
		predicate  string
		shouldFind string
	}{
		{name: "empty preserves legacy query", value: "", active: false},
		{
			name:       "24 hours uses a rolling window ending now",
			value:      "24",
			active:     true,
			hourly:     true,
			days:       1,
			predicate:  "ss.sampled_at >= now() - interval '24 hours' and ss.sampled_at < now()",
			shouldFind: "generate_series(now() - interval '24 hours', now() - interval '1 hour', interval '1 hour')",
		},
		{name: "7 days uses daily buckets", value: "7", active: true, days: 7, shouldFind: "current_date - (6 * interval '1 day')"},
		{name: "30 days uses daily buckets", value: "30", active: true, days: 30, shouldFind: "current_date - (29 * interval '1 day')"},
		{name: "all uses compressed all-time buckets", value: "all", active: true, all: true, predicate: "true", shouldFind: "ntile(30)"},
		{name: "unsupported preserves legacy query", value: "14", active: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizePublicChannelRange(tt.value)
			if got.active != tt.active || got.hourly != tt.hourly || got.all != tt.all || got.days != tt.days {
				t.Fatalf("range = %+v", got)
			}
			if tt.predicate != "" && got.snapshotPredicate("ss") != tt.predicate {
				t.Fatalf("predicate = %q, want %q", got.snapshotPredicate("ss"), tt.predicate)
			}
			if tt.shouldFind != "" && !strings.Contains(got.trendBucketsJoinSQL(), tt.shouldFind) {
				t.Fatalf("trend bucket SQL missing %q:\n%s", tt.shouldFind, got.trendBucketsJoinSQL())
			}
		})
	}
}

func TestParseTrendBucketsKeepsEmptyBuckets(t *testing.T) {
	raw := []byte(`[
		{"key":"2026-07-08T08:00:00Z","label":"08:00","value":91},
		{"key":"2026-07-08T09:00:00Z","label":"09:00","value":null}
	]`)
	got := parseTrendBuckets(raw)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].Value == nil || *got[0].Value != 91 {
		t.Fatalf("first value = %#v, want 91", got[0].Value)
	}
	if got[1].Value != nil {
		t.Fatalf("second value = %#v, want nil", got[1].Value)
	}
}

func TestRolling24HourTrendBucketKeyKeepsMinutePrecision(t *testing.T) {
	query := normalizePublicChannelRange("24").trendBucketsJoinSQL()
	if !strings.Contains(query, `YYYY-MM-DD"T"HH24:MI:SS"Z"`) {
		t.Fatalf("rolling bucket key must preserve its sub-hour start time:\n%s", query)
	}
}
