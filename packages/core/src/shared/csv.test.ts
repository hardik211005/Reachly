import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords, toCsv } from "./csv";

describe("CSV", () => {
  it("parses quoted fields, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿name,notes\r\n"Acme, Inc","said ""hi"""\r\nBeta,\r\n');
    expect(rows).toEqual([
      ["name", "notes"],
      ["Acme, Inc", 'said "hi"'],
      ["Beta", ""],
    ]);
  });

  it("maps records by header", () => {
    const { headers, records } = parseCsvRecords("Name,City\nHarbor Bistro,Delhi\n");
    expect(headers).toEqual(["Name", "City"]);
    expect(records[0]).toEqual({ Name: "Harbor Bistro", City: "Delhi" });
  });

  it("neutralises formula injection but keeps phone numbers", () => {
    const csv = toCsv(["a", "b", "c", "d"], [["=HYPERLINK(1)", "+91 98765 43210", "-SUM(A1)", "@cmd"]]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe("'=HYPERLINK(1),+91 98765 43210,'-SUM(A1),'@cmd");
  });
});
