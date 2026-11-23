import { createClient } from "npm:@supabase/supabase-js@2";
const JIBBLE_TOKEN_URL = "https://identity.prod.jibble.io/connect/token";
const JIBBLE_WORKSPACE_URL = "https://workspace.prod.jibble.io/v1";
const JIBBLE_TIME_TRACKING_URL = "https://time-tracking.prod.jibble.io/v1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function requiredEnv(name) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required Edge Function secret: ${name}`);
  return value;
}
function getSupabaseSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (rawSecretKeys) {
    try {
      const parsed = JSON.parse(rawSecretKeys);
      if (parsed.default) return parsed.default;
      const firstValue = Object.values(parsed).find((value)=>Boolean(value));
      if (firstValue) return firstValue;
    } catch  {
    // Continue to the explicit error below.
    }
  }
  throw new Error("No Supabase secret key is available. Expected SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY.");
}
function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve, ms));
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function notNull(value) {
  return value !== null && value !== undefined;
}
function arrayify(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [
    value
  ];
}
function getPath(source, path) {
  if (!isObject(source)) return undefined;
  const parts = path.split(".");
  let current = source;
  for (const part of parts){
    if (!isObject(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}
function pick(source, ...paths) {
  for (const path of paths){
    const value = getPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
function textOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function boolOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if ([
    "true",
    "yes",
    "1",
    "y"
  ].includes(normalized)) return true;
  if ([
    "false",
    "no",
    "0",
    "n"
  ].includes(normalized)) return false;
  return null;
}
function uuidOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(text) ? text : null;
}
function timestampOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function dateOnlyOrNull(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const isoMatch = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function objectName(value) {
  if (typeof value === "string") return textOrNull(value);
  if (!isObject(value)) return null;
  return textOrNull(pick(value, "name", "fullName", "preferredName", "displayName", "roleName"));
}
function extractId(value) {
  if (typeof value === "string") return uuidOrNull(value);
  if (!isObject(value)) return null;
  return uuidOrNull(pick(value, "id", "personId", "managerId", "locationId", "groupId", "kioskId"));
}
function parseIsoDurationSeconds(value) {
  const text = textOrNull(value);
  if (!text) return null;
  const plainNumber = Number(text);
  if (Number.isFinite(plainNumber)) return Math.round(plainNumber);
  const iso = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!iso) return null;
  const days = Number(iso[1] ?? 0);
  const hours = Number(iso[2] ?? 0);
  const minutes = Number(iso[3] ?? 0);
  const seconds = Number(iso[4] ?? 0);
  return Math.round(days * 86400 + hours * 3600 + minutes * 60 + seconds);
}
function dateInTimezone(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${dateText}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function validateDateInput(value, fieldName) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be provided in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${fieldName} is not a valid date.`);
  return value;
}
function resolveDateRange(request, timezone) {
  const mode = request.mode ?? "live";
  if (mode === "test_oauth" || mode === "probe" || mode === "master") return null;
  const today = dateInTimezone(new Date(), timezone);
  if (mode === "backfill") {
    const startDate = validateDateInput(request.start_date, "start_date");
    const inclusiveEndDate = validateDateInput(request.end_date, "end_date");
    if (inclusiveEndDate < startDate) throw new Error("end_date cannot be earlier than start_date.");
    return {
      startDate,
      endDateExclusive: addDays(inclusiveEndDate, 1)
    };
  }
  const defaultLookback = mode === "repair" ? 14 : 2;
  const lookbackDays = Math.max(1, Math.min(Number(request.lookback_days ?? defaultLookback), 60));
  return {
    startDate: addDays(today, -(lookbackDays - 1)),
    endDateExclusive: addDays(today, 1)
  };
}
async function fetchWithRetry(url, init, label) {
  let lastError = null;
  for(let attempt = 1; attempt <= 4; attempt++){
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      const body = await response.text();
      if (response.status === 429 || response.status >= 500) {
        const retryAfterSeconds = Number(response.headers.get("retry-after") ?? 0);
        const delayMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : attempt * 1500;
        lastError = new Error(`${label} returned ${response.status}: ${body.slice(0, 1000)}`);
        await sleep(delayMs);
        continue;
      }
      throw new Error(`${label} returned ${response.status}: ${body.slice(0, 2000)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 4) {
        await sleep(attempt * 1500);
        continue;
      }
    }
  }
  throw lastError ?? new Error(`${label} failed after retries.`);
}
async function getJibbleToken(clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });
  const response = await fetchWithRetry(JIBBLE_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  }, "Jibble OAuth token request");
  const payload = await response.json();
  if (!textOrNull(payload.access_token)) {
    throw new Error("Jibble OAuth response did not contain access_token.");
  }
  return payload;
}
async function fetchODataCollection(endpoint, accessToken, query = {}, pageSize = 200, maxPages = 500) {
  const allRows = [];
  let skip = 0;
  for(let page = 0; page < maxPages; page++){
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(query))url.searchParams.set(key, value);
    url.searchParams.set("$skip", String(skip));
    url.searchParams.set("$top", String(pageSize));
    if (!url.searchParams.has("$count")) url.searchParams.set("$count", "true");
    const response = await fetchWithRetry(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    }, `Jibble collection request: ${endpoint}`);
    const payload = await response.json();
    const value = payload.value;
    const rows = Array.isArray(value) ? value.filter(isObject) : Array.isArray(payload) ? payload.filter(isObject) : [];
    allRows.push(...rows);
    const count = numberOrNull(payload["@odata.count"]);
    if (rows.length < pageSize) break;
    skip += rows.length;
    if (count !== null && skip >= count) break;
  }
  return allRows;
}
async function fetchSingleJson(endpoint, accessToken) {
  const response = await fetchWithRetry(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  }, `Jibble item request: ${endpoint}`);
  const payload = await response.json();
  if (!isObject(payload)) throw new Error(`Expected an object from ${endpoint}`);
  return payload;
}
async function upsertInChunks(supabase, table, rows, onConflict, chunkSize = 300) {
  if (!rows.length) return 0;
  let total = 0;
  for(let i = 0; i < rows.length; i += chunkSize){
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, {
      onConflict,
      ignoreDuplicates: false
    });
    if (error) throw new Error(`Supabase upsert failed for ${table}: ${error.message}`);
    total += chunk.length;
  }
  return total;
}
async function loadAllRows(supabase, table, columns) {
  const rows = [];
  const pageSize = 1000;
  for(let from = 0; from < 100000; from += pageSize){
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
function extractManagerIds(person) {
  const refs = arrayify(pick(person, "managers", "managerIds", "managerPeople", "manager", "managedBy"));
  const ids = refs.map((ref)=>{
    if (typeof ref === "string") return uuidOrNull(ref);
    if (!isObject(ref)) return null;
    return uuidOrNull(pick(ref, "personId", "managerId", "id", "person.id", "manager.id"));
  }).filter((value)=>Boolean(value));
  return [
    ...new Set(ids)
  ];
}
function extractRole(person) {
  const direct = pick(person, "role", "roleName", "userRole", "permissionRole");
  const directName = objectName(direct) ?? textOrNull(direct);
  if (directName) return directName;
  const roleRefs = arrayify(pick(person, "roles", "userRoles"));
  const names = roleRefs.map(objectName).filter((value)=>Boolean(value));
  return names.length ? names.join(";") : null;
}
async function syncGroups(supabase, accessToken) {
  const groups = await fetchODataCollection(`${JIBBLE_WORKSPACE_URL}/Groups`, accessToken, {
    "$orderby": "name asc"
  });
  const now = new Date().toISOString();
  const rows = groups.map((group)=>{
    const groupId = uuidOrNull(pick(group, "id", "groupId"));
    if (!groupId) return null;
    return {
      group_id: groupId,
      group_name: textOrNull(pick(group, "name", "groupName")),
      group_code: textOrNull(pick(group, "code", "groupCode")),
      status: textOrNull(pick(group, "status")),
      source_updated_at: timestampOrNull(pick(group, "updatedAt", "lastUpdatedAt")),
      raw_payload: group,
      synced_at: now
    };
  }).filter(notNull);
  await upsertInChunks(supabase, "jibble_groups", rows, "group_id");
  return rows;
}
async function syncPeople(supabase, accessToken, groups) {
  const people = await fetchODataCollection(`${JIBBLE_WORKSPACE_URL}/People`, accessToken, {
    "$expand": "group",
    "$orderby": "fullName asc"
  });
  const groupMap = new Map();
  for (const group of groups){
    const id = uuidOrNull(group.group_id);
    if (id) groupMap.set(id, group);
  }
  const personRawMap = new Map();
  for (const person of people){
    const id = uuidOrNull(pick(person, "id", "personId"));
    if (id) personRawMap.set(id, person);
  }
  const now = new Date().toISOString();
  const rows = people.map((person)=>{
    const personId = uuidOrNull(pick(person, "id", "personId"));
    if (!personId) return null;
    const groupId = uuidOrNull(pick(person, "groupId", "group.id"));
    const group = groupId ? groupMap.get(groupId) : undefined;
    const managerIds = extractManagerIds(person);
    const managerNames = managerIds.map((id)=>textOrNull(pick(personRawMap.get(id), "fullName", "preferredName"))).filter((value)=>Boolean(value));
    const managerCodes = managerIds.map((id)=>textOrNull(pick(personRawMap.get(id), "code", "memberCode"))).filter((value)=>Boolean(value));
    return {
      person_id: personId,
      full_name: textOrNull(pick(person, "fullName", "preferredName", "name")),
      member_code: textOrNull(pick(person, "code", "memberCode")),
      email: textOrNull(pick(person, "email")),
      group_id: groupId,
      group_name: textOrNull(pick(person, "group.name")) ?? textOrNull(group?.group_name),
      role: extractRole(person),
      manager_ids: managerIds,
      manager_names: managerNames.length ? managerNames.join(";") : null,
      manager_codes: managerCodes.length ? managerCodes.join(";") : null,
      status: textOrNull(pick(person, "status")),
      source_updated_at: timestampOrNull(pick(person, "updatedAt", "lastUpdatedAt")),
      raw_payload: person,
      synced_at: now
    };
  }).filter(notNull);
  await upsertInChunks(supabase, "jibble_people", rows, "person_id");
  return rows;
}
async function syncLocations(supabase, accessToken) {
  const locations = await fetchODataCollection(`${JIBBLE_WORKSPACE_URL}/Locations`, accessToken, {
    "$orderby": "name asc"
  });
  const now = new Date().toISOString();
  const rows = locations.map((location)=>{
    const locationId = uuidOrNull(pick(location, "id", "locationId"));
    if (!locationId) return null;
    return {
      location_id: locationId,
      location_name: textOrNull(pick(location, "name", "locationName")),
      location_code: textOrNull(pick(location, "code", "locationCode")),
      address: textOrNull(pick(location, "address", "formattedAddress")),
      latitude: numberOrNull(pick(location, "coordinates.latitude", "latitude")),
      longitude: numberOrNull(pick(location, "coordinates.longitude", "longitude")),
      status: textOrNull(pick(location, "status")),
      source_updated_at: timestampOrNull(pick(location, "updatedAt", "lastUpdatedAt")),
      raw_payload: location,
      synced_at: now
    };
  }).filter(notNull);
  await upsertInChunks(supabase, "jibble_locations", rows, "location_id");
  return rows;
}
async function syncMasterData(supabase, accessToken) {
  const groups = await syncGroups(supabase, accessToken);
  const [people, locations] = await Promise.all([
    syncPeople(supabase, accessToken, groups),
    syncLocations(supabase, accessToken)
  ]);
  return {
    groups,
    people,
    locations
  };
}
function extractKioskId(entry) {
  return uuidOrNull(pick(entry, "kioskId", "kiosk.id", "platform.kioskId", "client.kioskId", "source.kioskId"));
}
async function syncKiosksByIds(supabase, accessToken, kioskIds) {
  if (!kioskIds.length) return [];
  const existingRows = await loadAllRows(supabase, "jibble_kiosks", "kiosk_id,kiosk_name,location_id");
  const existingIds = new Set(existingRows.map((row)=>uuidOrNull(row.kiosk_id)).filter((id)=>Boolean(id)));
  const missingIds = [
    ...new Set(kioskIds)
  ].filter((id)=>!existingIds.has(id));
  const fetched = [];
  for (const kioskId of missingIds){
    try {
      const kiosk = await fetchSingleJson(`${JIBBLE_WORKSPACE_URL}/Kiosks/${kioskId}?$expand=Location($select=id,name,coordinates)`, accessToken);
      fetched.push(kiosk);
    } catch (error) {
      console.warn(`Unable to fetch kiosk ${kioskId}:`, error instanceof Error ? error.message : error);
    }
  }
  const now = new Date().toISOString();
  const rows = fetched.map((kiosk)=>{
    const kioskId = uuidOrNull(pick(kiosk, "id", "kioskId"));
    if (!kioskId) return null;
    return {
      kiosk_id: kioskId,
      kiosk_name: textOrNull(pick(kiosk, "name", "kioskName")),
      location_id: uuidOrNull(pick(kiosk, "locationId", "location.id", "Location.id")),
      status: textOrNull(pick(kiosk, "status")),
      source_updated_at: timestampOrNull(pick(kiosk, "updatedAt", "lastUpdatedAt")),
      raw_payload: kiosk,
      synced_at: now
    };
  }).filter(notNull);
  await upsertInChunks(supabase, "jibble_kiosks", rows, "kiosk_id");
  return rows;
}
function personMapFromRows(rows) {
  const map = new Map();
  for (const row of rows){
    const id = uuidOrNull(row.person_id ?? pick(row, "id", "personId"));
    if (id) map.set(id, row);
  }
  return map;
}
function locationMapFromRows(rows) {
  const map = new Map();
  for (const row of rows){
    const id = uuidOrNull(row.location_id ?? pick(row, "id", "locationId"));
    if (id) map.set(id, row);
  }
  return map;
}
function kioskMapFromRows(rows) {
  const map = new Map();
  for (const row of rows){
    const id = uuidOrNull(row.kiosk_id ?? pick(row, "id", "kioskId"));
    if (id) map.set(id, row);
  }
  return map;
}
function extractAuthorId(entry) {
  return uuidOrNull(pick(entry, "authorId", "author.id", "createdById", "createdByPersonId", "createdBy.id", "createdByPerson.id", "creator.id"));
}
function deriveSelfieTaken(entry) {
  const explicit = boolOrNull(pick(entry, "selfieTaken", "isSelfieTaken", "hasSelfie", "facialRecognition.selfieTaken"));
  if (explicit !== null) return explicit;
  const selfie = pick(entry, "selfie", "selfieUrl", "selfieImage", "facialRecognition.selfieUrl");
  return selfie === undefined || selfie === null || selfie === "" ? null : true;
}
function deriveMobileMode(entry, kioskId) {
  return textOrNull(pick(entry, "mobileAppMode", "appMode", "mode", "platform.appMode")) ?? (kioskId ? "Kiosk" : null);
}
function buildTimeEntryRow(entry, people, locations, kiosks, defaultTimezone) {
  const entryId = uuidOrNull(pick(entry, "id", "timeEntryId"));
  if (!entryId) return null;
  const personId = uuidOrNull(pick(entry, "personId", "person.id"));
  const person = personId ? people.get(personId) : undefined;
  const locationId = uuidOrNull(pick(entry, "locationId", "location.id"));
  const location = locationId ? locations.get(locationId) : undefined;
  const kioskId = extractKioskId(entry);
  const kiosk = kioskId ? kiosks.get(kioskId) : undefined;
  const authorId = extractAuthorId(entry);
  const author = authorId ? people.get(authorId) : undefined;
  const entryTime = timestampOrNull(pick(entry, "time", "dateTime", "timestamp"));
  const entryDate = dateOnlyOrNull(pick(entry, "belongsToDate", "date")) ?? (entryTime ? entryTime.slice(0, 10) : null);
  const rawPlatform = pick(entry, "platform");
  const platform = isObject(rawPlatform) ? rawPlatform : {};
  const latitude = numberOrNull(pick(entry, "coordinates.latitude", "latitude", "location.coordinates.latitude"));
  const longitude = numberOrNull(pick(entry, "coordinates.longitude", "longitude", "location.coordinates.longitude"));
  const locationName = textOrNull(pick(entry, "location.name", "locationName")) ?? textOrNull(location?.location_name);
  const locationAddress = textOrNull(pick(entry, "address", "location.address", "locationAddress")) ?? textOrNull(location?.address);
  const authorName = textOrNull(pick(entry, "author.fullName", "author.name", "createdBy.fullName")) ?? textOrNull(author?.full_name);
  const authorCode = textOrNull(pick(entry, "author.code", "createdBy.code")) ?? textOrNull(author?.member_code);
  const kioskName = textOrNull(pick(entry, "kiosk.name", "kioskName")) ?? textOrNull(kiosk?.kiosk_name);
  return {
    jibble_entry_id: entryId,
    person_id: personId,
    entry_date: entryDate,
    entry_type: textOrNull(pick(entry, "type", "entryType")),
    entry_time: entryTime,
    local_time: textOrNull(pick(entry, "localTime")),
    duration_seconds: parseIsoDurationSeconds(pick(entry, "duration", "durationSeconds", "workedDuration")),
    billable_amount: numberOrNull(pick(entry, "billableAmount", "billing.amount", "amount")) ?? 0,
    clock_in_device: textOrNull(pick(entry, "clientType", "deviceType", "platform.clientType", "source")),
    device_name: textOrNull(pick(entry, "platform.deviceName", "platform.browser", "platform.browserName", "platform.deviceModel", "deviceName")) ?? textOrNull(pick(platform, "os")),
    location_id: locationId,
    location_name: locationName,
    location_address: locationAddress,
    author_person_id: authorId,
    author_name: authorName,
    author_code: authorCode,
    created_on: timestampOrNull(pick(entry, "createdAt", "createdOn")),
    role: textOrNull(person?.role),
    manager_names: textOrNull(person?.manager_names),
    manager_codes: textOrNull(person?.manager_codes),
    selfie_taken: deriveSelfieTaken(entry),
    offline_mode: boolOrNull(pick(entry, "offlineMode", "isOffline", "offline")),
    flagged: boolOrNull(pick(entry, "flagged", "isFlagged", "hasFlag")),
    timezone: textOrNull(pick(entry, "timezone", "timeZone")) ?? defaultTimezone,
    automatic_jibble_out: boolOrNull(pick(entry, "automaticJibbleOut", "automaticClockOut", "isAutoClockOut", "autoClockOut")),
    mobile_app_mode: deriveMobileMode(entry, kioskId),
    kiosk_id: kioskId,
    kiosk_name: kioskName,
    latitude,
    longitude,
    status: textOrNull(pick(entry, "status")),
    source_updated_at: timestampOrNull(pick(entry, "updatedAt", "lastUpdatedAt")),
    raw_payload: entry,
    synced_at: new Date().toISOString()
  };
}
async function ensureMasterMaps(supabase, accessToken) {
  let peopleRows = await loadAllRows(supabase, "jibble_people", "person_id,full_name,member_code,group_id,group_name,role,manager_names,manager_codes,status");
  let locationRows = await loadAllRows(supabase, "jibble_locations", "location_id,location_name,location_code,address,latitude,longitude,status");
  const masterStats = {
    groups_fetched: 0,
    people_fetched: 0,
    locations_fetched: 0
  };
  if (!peopleRows.length || !locationRows.length) {
    const master = await syncMasterData(supabase, accessToken);
    peopleRows = master.people;
    locationRows = master.locations;
    masterStats.groups_fetched = master.groups.length;
    masterStats.people_fetched = master.people.length;
    masterStats.locations_fetched = master.locations.length;
  }
  return {
    peopleRows,
    locationRows,
    masterStats
  };
}
async function syncTimeEntries(supabase, accessToken, range, timezone) {
  const { peopleRows, locationRows, masterStats } = await ensureMasterMaps(supabase, accessToken);
  const entries = await fetchODataCollection(`${JIBBLE_TIME_TRACKING_URL}/TimeEntries`, accessToken, {
    "$filter": `(belongsToDate ge ${range.startDate} and belongsToDate lt ${range.endDateExclusive})`,
    "$orderby": "time asc"
  });
  const peopleMap = personMapFromRows(peopleRows);
  const locationsMap = locationMapFromRows(locationRows);
  const kioskIds = entries.map(extractKioskId).filter((id)=>Boolean(id));
  const newlyFetchedKiosks = await syncKiosksByIds(supabase, accessToken, kioskIds);
  const allKioskRows = await loadAllRows(supabase, "jibble_kiosks", "kiosk_id,kiosk_name,location_id,status");
  const kiosksMap = kioskMapFromRows(allKioskRows);
  const rows = entries.map((entry)=>buildTimeEntryRow(entry, peopleMap, locationsMap, kiosksMap, timezone)).filter(notNull);
  const entriesUpserted = await upsertInChunks(supabase, "jibble_time_entries", rows, "jibble_entry_id");
  const { error: durationError } = await supabase.rpc("refresh_jibble_durations", {
    p_start_date: range.startDate,
    p_end_date_exclusive: range.endDateExclusive
  });
  if (durationError) {
    throw new Error(`Duration refresh failed: ${durationError.message}`);
  }
  return {
    entriesFetched: entries.length,
    entriesUpserted,
    kiosksFetched: newlyFetchedKiosks.length,
    masterStats
  };
}
async function updateSyncState(supabase, mode, values) {
  const { error } = await supabase.from("jibble_sync_state").upsert({
    sync_name: mode,
    ...values,
    updated_at: new Date().toISOString()
  }, {
    onConflict: "sync_name"
  });
  if (error) console.error("Unable to update jibble_sync_state:", error.message);
}
function keysOfObject(value) {
  return isObject(value) ? Object.keys(value).sort() : [];
}
Deno.serve(async (request)=>{
  if (request.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (request.method !== "POST") return jsonResponse({
    error: "Use POST."
  }, 405);
  let runId = null;
  let mode = "live";
  let range = null;
  let supabase = null;
  try {
    const syncSecret = requiredEnv("JIBBLE_SYNC_SECRET");
    if (request.headers.get("x-sync-secret") !== syncSecret) {
      return jsonResponse({
        error: "Unauthorized: invalid x-sync-secret."
      }, 401);
    }
    const clientId = requiredEnv("JIBBLE_CLIENT_ID");
    const clientSecret = requiredEnv("JIBBLE_CLIENT_SECRET");
    const timezone = Deno.env.get("JIBBLE_TIMEZONE")?.trim() || "Asia/Kolkata";
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const supabaseSecretKey = getSupabaseSecretKey();
    supabase = createClient(supabaseUrl, supabaseSecretKey, {
      db: {
        schema: "indr"
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    let body = {};
    try {
      body = await request.json();
    } catch  {
      body = {};
    }
    mode = body.mode ?? "live";
    const allowedModes = [
      "test_oauth",
      "probe",
      "master",
      "live",
      "repair",
      "backfill"
    ];
    if (!allowedModes.includes(mode)) {
      throw new Error(`Unsupported mode: ${String(mode)}`);
    }
    range = resolveDateRange(body, timezone);
    const { data: runRow, error: runError } = await supabase.from("jibble_sync_runs").insert({
      sync_mode: mode,
      range_start: range?.startDate ?? null,
      range_end_exclusive: range?.endDateExclusive ?? null,
      status: "running"
    }).select("id").single();
    if (runError) throw new Error(`Could not create sync audit row: ${runError.message}`);
    runId = String(runRow.id);
    await updateSyncState(supabase, mode, {
      last_started_at: new Date().toISOString(),
      last_range_start: range?.startDate ?? null,
      last_range_end_exclusive: range?.endDateExclusive ?? null,
      last_error: null
    });
    const tokenPayload = await getJibbleToken(clientId, clientSecret);
    const accessToken = requiredText(tokenPayload.access_token, "Jibble access token");
    if (mode === "test_oauth") {
      const summary = {
        success: true,
        mode,
        token_type: textOrNull(tokenPayload.token_type),
        expires_in: numberOrNull(tokenPayload.expires_in),
        message: "Jibble OAuth connection is working. The access token is intentionally not returned."
      };
      await finishRun(supabase, runId, summary, emptyStats());
      await markStateSuccessful(supabase, mode, range);
      return jsonResponse(summary);
    }
    if (mode === "probe") {
      const today = dateInTimezone(new Date(), timezone);
      const probeStart = addDays(today, -1);
      const probeEnd = addDays(today, 1);
      const [people, locations, entries] = await Promise.all([
        fetchODataCollection(`${JIBBLE_WORKSPACE_URL}/People`, accessToken, {
          "$expand": "group"
        }, 1, 1),
        fetchODataCollection(`${JIBBLE_WORKSPACE_URL}/Locations`, accessToken, {}, 1, 1),
        fetchODataCollection(`${JIBBLE_TIME_TRACKING_URL}/TimeEntries`, accessToken, {
          "$filter": `(belongsToDate ge ${probeStart} and belongsToDate lt ${probeEnd})`,
          "$orderby": "time desc"
        }, 1, 1)
      ]);
      const summary = {
        success: true,
        mode,
        person_keys: keysOfObject(people[0]),
        person_group_keys: keysOfObject(pick(people[0], "group")),
        location_keys: keysOfObject(locations[0]),
        time_entry_keys: keysOfObject(entries[0]),
        time_entry_platform_keys: keysOfObject(pick(entries[0], "platform")),
        note: "Only field names are returned; employee/time-entry values are not returned."
      };
      const stats = emptyStats();
      stats.people_fetched = people.length;
      stats.locations_fetched = locations.length;
      stats.entries_fetched = entries.length;
      await finishRun(supabase, runId, summary, stats);
      await markStateSuccessful(supabase, mode, range);
      return jsonResponse(summary);
    }
    const stats = emptyStats();
    if (mode === "master") {
      const master = await syncMasterData(supabase, accessToken);
      stats.groups_fetched = master.groups.length;
      stats.people_fetched = master.people.length;
      stats.locations_fetched = master.locations.length;
    } else {
      if (!range) throw new Error(`Date range was not resolved for ${mode}.`);
      const result = await syncTimeEntries(supabase, accessToken, range, timezone);
      stats.groups_fetched = result.masterStats.groups_fetched;
      stats.people_fetched = result.masterStats.people_fetched;
      stats.locations_fetched = result.masterStats.locations_fetched;
      stats.kiosks_fetched = result.kiosksFetched;
      stats.entries_fetched = result.entriesFetched;
      stats.entries_upserted = result.entriesUpserted;
    }
    const summary = {
      success: true,
      mode,
      range_start: range?.startDate ?? null,
      range_end_exclusive: range?.endDateExclusive ?? null,
      stats
    };
    await finishRun(supabase, runId, summary, stats);
    await markStateSuccessful(supabase, mode, range);
    return jsonResponse(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Jibble sync failed:", message);
    if (supabase && runId) {
      await supabase.from("jibble_sync_runs").update({
        completed_at: new Date().toISOString(),
        status: "failed",
        error_message: message,
        response_summary: {
          success: false,
          mode,
          error: message
        }
      }).eq("id", runId);
    }
    if (supabase) {
      await updateSyncState(supabase, mode, {
        last_error: message,
        last_range_start: range?.startDate ?? null,
        last_range_end_exclusive: range?.endDateExclusive ?? null
      });
    }
    return jsonResponse({
      success: false,
      mode,
      error: message
    }, 500);
  }
});
function requiredText(value, label) {
  const text = textOrNull(value);
  if (!text) throw new Error(`${label} is missing.`);
  return text;
}
function emptyStats() {
  return {
    groups_fetched: 0,
    people_fetched: 0,
    locations_fetched: 0,
    kiosks_fetched: 0,
    entries_fetched: 0,
    entries_upserted: 0
  };
}
async function finishRun(supabase, runId, summary, stats) {
  const { error } = await supabase.from("jibble_sync_runs").update({
    completed_at: new Date().toISOString(),
    status: "completed",
    ...stats,
    error_message: null,
    response_summary: summary
  }).eq("id", runId);
  if (error) throw new Error(`Could not complete sync audit row: ${error.message}`);
}
async function markStateSuccessful(supabase, mode, range) {
  await updateSyncState(supabase, mode, {
    last_successful_at: new Date().toISOString(),
    last_range_start: range?.startDate ?? null,
    last_range_end_exclusive: range?.endDateExclusive ?? null,
    last_error: null
  });
}
