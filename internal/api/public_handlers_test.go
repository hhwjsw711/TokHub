package api

import (
	"net/http/httptest"
	"testing"
)

func TestPublicRangeDays(t *testing.T) {
	tests := []struct {
		query string
		want  int
	}{
		{query: "", want: 0},
		{query: "?range=24", want: 1},
		{query: "?range=7", want: 7},
		{query: "?range=30", want: 30},
		{query: "?range=all", want: -1},
		{query: "?days=14", want: 14},
		{query: "?range=120", want: 90},
		{query: "?range=-2", want: 0},
	}
	for _, tt := range tests {
		req := httptest.NewRequest("GET", "/api/public/providers/rank"+tt.query, nil)
		if got := publicRangeDays(req); got != tt.want {
			t.Fatalf("publicRangeDays(%q) = %d, want %d", tt.query, got, tt.want)
		}
	}
}
