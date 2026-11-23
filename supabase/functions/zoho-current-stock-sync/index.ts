import { createClient } from "npm:@supabase/supabase-js@2";

const SCHEMA_NAME = "indr";
const TABLE_NAME = "zoho_current_stock";

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in";

const ACCOUNT_OWNER = "zobocon";
const APP_LINK_NAME = "site-inventory-management";
const REPORT_LINK_NAME = "Current_Stock_Report";

const TARGET_SITE = "Adarsh Park Heights";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(
      `Missing required Edge Function secret: ${name}`,
    );
  }

  return value;
}

function getSupabaseSecretKey(): string {
  const legacy =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (legacy) {
    return legacy;
  }

  const rawSecretKeys =
    Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();

  if (rawSecretKeys) {
    try {
      const parsed = JSON.parse(rawSecretKeys);

      if (parsed.default) {
        return parsed.default;
      }

      const firstValue = Object.values(parsed).find(
        (value) => Boolean(value),
      );

      if (firstValue) {
        return String(firstValue);
      }
    } catch {
      // Continue to explicit error below.
    }
  }

  throw new Error(
    "No Supabase secret key is available.",
  );
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  return text.length ? text : null;
}

function numberOrNull(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

type ZohoLookupValue = {
  ID?: string;
  zc_display_value?: string;
  Item_Name?: string;
  Site_Name?: string;
};

type ZohoStockRecord = {
  ID?: string;

  Item_Name?: ZohoLookupValue;
  Site_Name?: ZohoLookupValue;

  Available_Quantity?: string | number;
  Last_Updated?: string;
};

async function getZohoAccessToken() {
  const clientId = requiredEnv(
    "ZOHO_CLIENT_ID",
  );

  const clientSecret = requiredEnv(
    "ZOHO_CLIENT_SECRET",
  );

  const refreshToken = requiredEnv(
    "ZOHO_REFRESH_TOKEN",
  );

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(
    `${ZOHO_ACCOUNTS_URL}/oauth/v2/token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Zoho OAuth failed: ${JSON.stringify(payload)}`,
    );
  }

  if (!payload.access_token) {
    throw new Error(
      "Zoho OAuth response did not contain access_token.",
    );
  }

  if (!payload.api_domain) {
    throw new Error(
      "Zoho OAuth response did not contain api_domain.",
    );
  }

  return {
    accessToken: String(payload.access_token),
    apiDomain: String(payload.api_domain),
  };
}

async function fetchCurrentStockReport(
  accessToken: string,
  apiDomain: string,
): Promise<ZohoStockRecord[]> {
  const allRecords: ZohoStockRecord[] = [];

  let recordCursor: string | null = null;

  do {
    const url = new URL(
      `${apiDomain}/creator/v2.1/data/${ACCOUNT_OWNER}/${APP_LINK_NAME}/report/${REPORT_LINK_NAME}`,
    );

    url.searchParams.set(
      "max_records",
      "1000",
    );

    const headers: Record<string, string> = {
      Authorization:
        `Zoho-oauthtoken ${accessToken}`,
      Accept: "application/json",
    };

    if (recordCursor) {
      headers["record_cursor"] =
        recordCursor;
    }

    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        headers,
      },
    );

    const responseText =
      await response.text();

    let payload: any;

    try {
      payload = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      throw new Error(
        `Zoho returned invalid JSON: ${responseText}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Zoho Current Stock API returned ${response.status}: ${responseText}`,
      );
    }

    if (Array.isArray(payload.data)) {
      allRecords.push(
        ...payload.data,
      );
    }

    recordCursor =
      response.headers.get(
        "record_cursor",
      );
  } while (recordCursor);

  return allRecords;
}

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error:
            "Only POST method is allowed.",
        },
        405,
      );
    }

    /*
     * Same protection pattern as your
     * existing Jibble sync.
     */
    const syncSecret = requiredEnv(
      "ZOHO_CURRENT_STOCK_SYNC_SECRET",
    );

    if (
      request.headers.get(
        "x-sync-secret",
      ) !== syncSecret
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "Unauthorized: invalid x-sync-secret.",
        },
        401,
      );
    }

    const supabaseUrl =
      requiredEnv("SUPABASE_URL");

    const supabaseKey =
      getSupabaseSecretKey();

    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
    );

    const db =
      supabase.schema(SCHEMA_NAME);

    /*
     * 1. Generate fresh Zoho access token.
     */
    const {
      accessToken,
      apiDomain,
    } = await getZohoAccessToken();

    /*
     * 2. Fetch complete Current Stock Report.
     */
    const allRecords =
      await fetchCurrentStockReport(
        accessToken,
        apiDomain,
      );

    /*
     * 3. Filter ONLY Adarsh Park Heights.
     *
     * Do this after fetching because Site_Name
     * is a Zoho lookup object.
     */
    const targetRecords =
      allRecords.filter((record) => {
        const siteName =
          textOrNull(
            record.Site_Name
              ?.Site_Name,
          );

        return (
          siteName === TARGET_SITE
        );
      });

    const syncRunId =
      crypto.randomUUID();

    /*
     * 4. Convert Zoho records into our
     * Supabase mirror structure.
     */
    const rows = targetRecords
      .map((record) => {
        const materialName =
          textOrNull(
            record.Item_Name
              ?.Item_Name,
          );

        const siteName =
          textOrNull(
            record.Site_Name
              ?.Site_Name,
          );

        const zohoRecordId =
          textOrNull(record.ID);

        if (
          !materialName ||
          !siteName ||
          !zohoRecordId
        ) {
          return null;
        }

        return {
          zoho_record_id:
            zohoRecordId,

          item_id:
            textOrNull(
              record.Item_Name?.ID,
            ),

          material_name:
            materialName,

          site_id:
            textOrNull(
              record.Site_Name?.ID,
            ),

          site_name:
            siteName,

          available_quantity:
            numberOrNull(
              record.Available_Quantity,
            ),

          zoho_last_updated:
            textOrNull(
              record.Last_Updated,
            ),

          sync_run_id:
            syncRunId,

          synced_at:
            new Date().toISOString(),
        };
      })
      .filter(
        (row): row is NonNullable<
          typeof row
        > => row !== null,
      );

    /*
     * 5. Upsert current APH records.
     *
     * One record per material per site.
     */
    if (rows.length > 0) {
      const {
        error: upsertError,
      } = await db
        .from(TABLE_NAME)
        .upsert(rows, {
          onConflict:
            "site_name,material_name",
        });

      if (upsertError) {
        throw new Error(
          `Supabase stock upsert failed: ${upsertError.message}`,
        );
      }
    }

    /*
     * 6. Remove stale APH rows.
     *
     * IMPORTANT:
     * We only do this AFTER Zoho has been
     * fetched successfully.
     *
     * If Zoho currently has zero APH rows,
     * Supabase should also contain zero APH rows.
     */
    let deletedRows: {
      id: number;
    }[] = [];

    if (rows.length === 0) {
      const {
        data,
        error,
      } = await db
        .from(TABLE_NAME)
        .delete()
        .eq(
          "site_name",
          TARGET_SITE,
        )
        .select("id");

      if (error) {
        throw new Error(
          `Failed clearing stale APH stock: ${error.message}`,
        );
      }

      deletedRows =
        data ?? [];
    } else {
      const {
        data,
        error,
      } = await db
        .from(TABLE_NAME)
        .delete()
        .eq(
          "site_name",
          TARGET_SITE,
        )
        .neq(
          "sync_run_id",
          syncRunId,
        )
        .select("id");

      if (error) {
        throw new Error(
          `Failed removing stale APH stock: ${error.message}`,
        );
      }

      deletedRows =
        data ?? [];
    }

    return jsonResponse({
      success: true,

      targetSite:
        TARGET_SITE,

      totalZohoRecordsFetched:
        allRecords.length,

      targetSiteRecords:
        targetRecords.length,

      validRows:
        rows.length,

      staleRowsDeleted:
        deletedRows.length,

      syncedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Zoho Current Stock sync failed:",
      error,
    );

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500,
    );
  }
});