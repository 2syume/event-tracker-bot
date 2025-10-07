import { google } from "googleapis";
import type { EventRecord } from "./schema";

export type SheetsClient = {
  upsertEvent: (
    ev: EventRecord
  ) => Promise<{ action: "inserted" | "updated"; row: number }>;
};

function getAuthFromEnv() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_B64");
  const jsonStr = Buffer.from(b64, "base64").toString("utf8");
  const creds = JSON.parse(jsonStr);
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes,
  });
}

export async function createSheetsClient(
  sheetId: string,
  sheetName: string
): Promise<SheetsClient> {
  const auth = getAuthFromEnv();
  const sheets = google.sheets({ version: "v4", auth });

  async function ensureSheetExists(name: string) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const exists = (meta.data.sheets || []).some(
      (s) => s.properties?.title === name
    );
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: name } } }],
        },
      });
    }
  }

  async function ensureHeader() {
    await ensureSheetExists(sheetName);
    const header = [
      "tweetId",
      "url",
      "authorName",
      "authorHandle",
      "locale",
      "title",
      "description",
      "startDate",
      "endDate",
      "registrationUrl",
      "location",
      "images",
      "organizer",
      "price",
      "tags",
      "isEvent",
    ];
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:Z1`,
    });
    const values = getRes.data.values ?? [];
    if (values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${sheetName}!A1:${String.fromCharCode(64 + header.length)}1`,
        valueInputOption: "RAW",
        requestBody: { values: [header] },
      });
    }
  }

  async function readAllRows(): Promise<any[][]> {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:Z10000`,
    });
    return res.data.values ?? [];
  }

  function rowToIndexMap(rows: any[][]): Map<string, number> {
    const map = new Map<string, number>();
    rows.forEach((r, i) => {
      const tweetId = r[0];
      if (tweetId) map.set(String(tweetId), i + 2);
    });
    return map;
  }

  await ensureHeader();

  return {
    async upsertEvent(ev) {
      const rows = await readAllRows();
      const indexById = rowToIndexMap(rows);
      const rowValues = [
        ev.source.tweetId,
        ev.source.url,
        ev.source.authorName ?? "",
        ev.source.authorHandle ?? "",
        ev.locale ?? "",
        ev.title ?? "",
        ev.description ?? "",
        ev.startDate ?? "",
        ev.endDate ?? "",
        ev.registrationUrl ?? "",
        ev.location ?? "",
        (ev.images ?? []).join("\n"),
        ev.organizer ?? "",
        ev.price ?? "",
        (ev.tags ?? []).join(","),
        String(ev.isEvent),
      ];

      const existingRow = indexById.get(ev.source.tweetId);
      if (existingRow) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${sheetName}!A${existingRow}:${String.fromCharCode(
            64 + rowValues.length
          )}${existingRow}`,
          valueInputOption: "RAW",
          requestBody: { values: [rowValues] },
        });
        return { action: "updated" as const, row: existingRow };
      }

      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${sheetName}!A2`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [rowValues] },
      });
      // Parse appended row number
      const updatedRange = appendRes.data.updates?.updatedRange ?? "";
      const m = updatedRange.match(/!([A-Z]+)(\d+):/);
      const row = m ? Number(m[2]) : -1;
      return { action: "inserted" as const, row };
    },
  };
}
