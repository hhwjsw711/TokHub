package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeedSQLDoesNotOverwriteRuntimeOwnedRecords(t *testing.T) {
	contracts := map[string]string{
		"admin user":           seedAdminUserSQL,
		"default org":          seedDefaultOrgSQL,
		"default membership":   seedDefaultOrgMembershipSQL,
		"demo channel":         seedDemoChannelSQL,
		"notification channel": seedNotificationChannelSQL,
		"site config":          ensureSiteConfigSQL,
	}

	for name, sql := range contracts {
		normalized := strings.ToLower(sql)
		if !strings.Contains(normalized, "on conflict") {
			t.Fatalf("%s seed SQL must be conflict-safe: %s", name, sql)
		}
		if strings.Contains(normalized, "do update") {
			t.Fatalf("%s seed SQL must not update existing runtime data: %s", name, sql)
		}
		if !strings.Contains(normalized, "do nothing") {
			t.Fatalf("%s seed SQL should preserve existing records with do nothing: %s", name, sql)
		}
	}
}

func TestExplicitSiteConfigSaveStillUpdatesExistingConfig(t *testing.T) {
	normalized := strings.ToLower(setSiteConfigSQL)
	if !strings.Contains(normalized, "do update") {
		t.Fatalf("admin site config save must update existing config: %s", setSiteConfigSQL)
	}
}

func TestReleaseMigrationsDoNotOverwriteRuntimeManagedContent(t *testing.T) {
	migration0030 := readMigrationForContract(t, "0030_featured_recommendation_targets.sql")
	if strings.Contains(strings.ToLower(migration0030), "delete from recommend_picks") {
		t.Fatal("0030 must not clear existing recommendation picks")
	}
	if !strings.Contains(strings.ToLower(migration0030), "on conflict do nothing") {
		t.Fatal("0030 should skip existing recommendation picks on conflict")
	}

	migration0035 := strings.ToLower(readMigrationForContract(t, "0035_refresh_featured_claude_code_providers.sql"))
	if !strings.Contains(migration0035, "coalesce(c.data_origin, '') in ('demo', 'test')") {
		t.Fatal("0035 channel refresh must be limited to demo/test channels")
	}
	if !strings.Contains(migration0035, "coalesce(rp.data_origin, '') in ('demo', 'test')") {
		t.Fatal("0035 recommendation refresh must be limited to demo/test picks")
	}

	migration0043 := strings.ToLower(readMigrationForContract(t, "0043_sync_featured_recommendation_picks.sql"))
	if strings.Contains(migration0043, "delete from recommend_picks") {
		t.Fatal("0043 must not delete existing recommendation picks")
	}
	if strings.Contains(migration0043, "insert into channels") {
		t.Fatal("0043 must not create default platform channels")
	}
	if strings.Contains(migration0043, "insert into recommend_picks") {
		t.Fatal("0043 must not create database-backed default recommendation picks")
	}
}

func TestProviderAffiliateLinkMigrationIsScopedAndSecretFree(t *testing.T) {
	migration0045 := strings.ToLower(readMigrationForContract(t, "0045_update_provider_affiliate_links.sql"))
	expectedLinks := []string{
		"https://www.ccsub.net/go/vwp3gkkd",
		"https://runapi.co/register?aff=dw73",
		"https://www.aicodemirror.com/register?invitecode=y61tp9",
		"https://crazyrouter.com/register?aff=xcyn",
		"https://apikey.fun/register?aff=wf5quc4nwv4k",
		"https://apinebula.com/kn9g18",
	}
	for _, link := range expectedLinks {
		if !strings.Contains(migration0045, link) {
			t.Fatalf("0045 must include affiliate link %q", link)
		}
	}
	for _, guard := range []string{
		"c.owner_type = 'platform'",
		"c.deleted_at is null",
		"c.status <> 'deleted'",
		"update recommend_picks",
	} {
		if !strings.Contains(migration0045, guard) {
			t.Fatalf("0045 must keep scope guard %q", guard)
		}
	}
	if strings.Contains(migration0045, "sk-") {
		t.Fatal("0045 must not contain provider API keys")
	}
}

func readMigrationForContract(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
