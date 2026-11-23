import { createClient } from 'npm:@supabase/supabase-js@2';
const SCHEMA_NAME = 'indr';
const TABLE_NAME = 'billing_tracker_indr';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function hasColumn(row, columnName) {
  return Object.prototype.hasOwnProperty.call(row, columnName);
}
function getString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (text.toLowerCase() === 'null') return null;
  if (text.toLowerCase() === 'undefined') return null;
  return text;
}
function getNumber(value) {
  const text = getString(value);
  if (!text) return null;
  const cleaned = text.replace(/,/g, '');
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : null;
}
function getInteger(value) {
  const numberValue = getNumber(value);
  if (numberValue === null) return null;
  return Math.trunc(numberValue);
}
function getBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = getString(value)?.toLowerCase();
  if (!text) return null;
  if ([
    'true',
    'yes',
    'y',
    '1',
    'checked'
  ].includes(text)) return true;
  if ([
    'false',
    'no',
    'n',
    '0',
    'unchecked'
  ].includes(text)) return false;
  return null;
}
function getDate(value) {
  const text = getString(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const mmddyyyy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, mm, dd, yyyy] = mmddyyyy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return text;
}
function getIdFromRow(row) {
  return getString(row['id']) || getString(row['ID']) || getString(row['Id']) || getString(row['Row ID']);
}
function mapAppSheetRowToSupabase(row) {
  const id = getIdFromRow(row);
  if (!id) {
    throw new Error('id is required for sync');
  }
  const data = {
    id
  };
  if (hasColumn(row, 'Application')) {
    data['Application'] = getString(row['Application']);
  }
  if (hasColumn(row, 'Flat')) {
    data['Flat'] = getString(row['Flat']);
  }
  if (hasColumn(row, 'Surface Type')) {
    data['Surface Type'] = getString(row['Surface Type']);
  }
  if (hasColumn(row, 'Layer Name')) {
    data['Layer Name'] = getString(row['Layer Name']);
  }
  if (hasColumn(row, 'Billed')) {
    data['Billed'] = getBoolean(row['Billed']);
  }
  if (hasColumn(row, 'Billing Number')) {
    data['Billing Number'] = getString(row['Billing Number']);
  }
  if (hasColumn(row, 'Billing Date')) {
    data['Billing Date'] = getDate(row['Billing Date']);
  }
  if (hasColumn(row, 'Rate')) {
    data['Rate'] = getNumber(row['Rate']);
  }
  if (hasColumn(row, 'Billing Area')) {
    data['Billing Area'] = getNumber(row['Billing Area']);
  }
  if (hasColumn(row, 'Status')) {
    data['Status'] = getString(row['Status']);
  }
  if (hasColumn(row, 'Batch no.')) {
    data['Batch no.'] = getInteger(row['Batch no.']);
  }
  if (hasColumn(row, 'WorkDonePct')) {
    data['WorkDonePct'] = getNumber(row['WorkDonePct']);
  }
  if (hasColumn(row, 'Is Complete')) {
    data['Is Complete'] = getBoolean(row['Is Complete']);
  }
  if (hasColumn(row, 'Can Billed')) {
    data['Can Billed'] = getBoolean(row['Can Billed']);
  }
  if (hasColumn(row, 'Batch')) {
    data['Batch'] = getString(row['Batch']);
  }
  return data;
}
function normalizeForCompare(value) {
  if (value === undefined) return null;
  if (value === '') return null;
  if (typeof value === 'number') {
    return Number(value.toFixed(6));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return null;
    return text;
  }
  return value;
}
function getChangedColumns(existingRow, incomingRow) {
  const changes = {};
  for (const [column, newValue] of Object.entries(incomingRow)){
    if (column === 'id') continue;
    const oldValue = existingRow[column];
    const normalizedOldValue = normalizeForCompare(oldValue);
    const normalizedNewValue = normalizeForCompare(newValue);
    if (JSON.stringify(normalizedOldValue) !== JSON.stringify(normalizedNewValue)) {
      changes[column] = {
        old: oldValue ?? null,
        new: newValue ?? null
      };
    }
  }
  return changes;
}
Deno.serve(async (req)=>{
  try {
    console.log('--- AppSheet billing sync started ---');
    console.log('Method:', req.method);
    console.log('Schema:', SCHEMA_NAME);
    console.log('Table:', TABLE_NAME);
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: corsHeaders
      });
    }
    if (req.method !== 'POST') {
      return Response.json({
        success: false,
        error: 'Only POST method is allowed'
      }, {
        status: 405,
        headers: corsHeaders
      });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    console.log('Supabase URL configured:', Boolean(supabaseUrl));
    console.log('Supabase key configured:', Boolean(supabaseKey));
    if (!supabaseUrl || !supabaseKey) {
      return Response.json({
        success: false,
        error: 'Supabase environment variables are missing'
      }, {
        status: 500,
        headers: corsHeaders
      });
    }
    const rawBody = await req.text();
    console.log('Raw body:', rawBody);
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch  {
      return Response.json({
        success: false,
        error: 'Invalid JSON body',
        rawBody
      }, {
        status: 400,
        headers: corsHeaders
      });
    }
    console.log('Parsed payload:', JSON.stringify(payload));
    const action = String(payload.action || payload.operation || 'UPSERT').toUpperCase();
    const incomingRow = payload.row || payload.data;
    if (!incomingRow) {
      return Response.json({
        success: false,
        error: 'row/data object is required',
        payload
      }, {
        status: 400,
        headers: corsHeaders
      });
    }
    const id = getIdFromRow(incomingRow);
    console.log('Action:', action);
    console.log('Resolved id:', id);
    if (!id) {
      return Response.json({
        success: false,
        error: 'id is required',
        receivedRow: incomingRow
      }, {
        status: 400,
        headers: corsHeaders
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const db = supabase.schema(SCHEMA_NAME);
    if (action === 'DELETE') {
      console.log('Deleting row with id:', id);
      const { error } = await db.from(TABLE_NAME).delete().eq('id', id);
      if (error) {
        console.error('Delete error:', JSON.stringify(error));
        throw error;
      }
      return Response.json({
        success: true,
        schema: SCHEMA_NAME,
        table: TABLE_NAME,
        action: 'DELETE',
        id,
        message: `Deleted row with id ${id}`
      }, {
        headers: corsHeaders
      });
    }
    if (![
      'UPSERT',
      'ADD',
      'UPDATE'
    ].includes(action)) {
      return Response.json({
        success: false,
        error: `Unsupported action: ${action}`
      }, {
        status: 400,
        headers: corsHeaders
      });
    }
    const incomingData = mapAppSheetRowToSupabase(incomingRow);
    console.log('Incoming mapped data:', JSON.stringify(incomingData));
    const { data: existingRow, error: fetchError } = await db.from(TABLE_NAME).select('*').eq('id', id).maybeSingle();
    if (fetchError) {
      console.error('Fetch existing row error:', JSON.stringify(fetchError));
      throw fetchError;
    }
    console.log('Existing row found:', Boolean(existingRow));
    if (!existingRow) {
      console.log('Inserting new row');
      const { error: insertError } = await db.from(TABLE_NAME).insert(incomingData);
      if (insertError) {
        console.error('Insert error:', JSON.stringify(insertError));
        throw insertError;
      }
      return Response.json({
        success: true,
        schema: SCHEMA_NAME,
        table: TABLE_NAME,
        action: 'INSERT',
        id,
        insertedData: incomingData
      }, {
        headers: corsHeaders
      });
    }
    const changes = getChangedColumns(existingRow, incomingData);
    console.log('Changes:', JSON.stringify(changes));
    if (Object.keys(changes).length === 0) {
      return Response.json({
        success: true,
        schema: SCHEMA_NAME,
        table: TABLE_NAME,
        action: 'NO_CHANGE',
        id,
        message: `No changes found for id ${id}`
      }, {
        headers: corsHeaders
      });
    }
    const updateData = {};
    for (const column of Object.keys(changes)){
      updateData[column] = incomingData[column];
    }
    console.log('Update data:', JSON.stringify(updateData));
    const { error: updateError } = await db.from(TABLE_NAME).update(updateData).eq('id', id);
    if (updateError) {
      console.error('Update error:', JSON.stringify(updateError));
      throw updateError;
    }
    return Response.json({
      success: true,
      schema: SCHEMA_NAME,
      table: TABLE_NAME,
      action: 'UPDATE',
      id,
      changes,
      updatedData: updateData
    }, {
      headers: corsHeaders
    });
  } catch (error) {
    console.error('Unhandled function error:', error);
    return Response.json({
      success: false,
      schema: SCHEMA_NAME,
      table: TABLE_NAME,
      error: error instanceof Error ? error.message : String(error),
      rawError: JSON.stringify(error)
    }, {
      status: 500,
      headers: corsHeaders
    });
  }
});
