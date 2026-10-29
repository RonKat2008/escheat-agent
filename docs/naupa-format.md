# NAUPA Standard Electronic File Format (NAUPA II): field layout

**Source (official, NAUPA):** "NAUPA Standard Electronic File Format", 24-page PDF:
https://unclaimed.org/wp-content/uploads/NAUPAIIStandardElectronicFileFormat-1.29.25.pdf
It is linked from https://unclaimed.org/reporting-software-and-naupa-file-format/, which says: "NAUPA II is the current version in production." The file was downloaded and text-extracted on 2026-10-29. Page numbers below are the PDF's own page numbers.

The DE Holder Handbook (Aug 2026, p.62) links an older copy, `NAUPAStandardElectronicFileFormat-11.20.19.pdf`. That copy was not fetched. The 1.29.25 file is the one NAUPA currently links.

## General rules (pp. 2–4)
- The file is "non-delimited ASCII format" and "Each record will be separated by a Carriage-Return and Line-Feed (CR/LF)" (p.2).
- Numeric fields (`N`): "right-justified, zero filled, with decimal points assumed. No decimal points are actually entered." Character fields (`C`): "left-justified, space filled" (p.2).
- Each record is **625 bytes**: "The first byte of each record contains a TR-CODE that denotes the type of record, and the subsequent 624 bytes are used to store the fields" (p.3).
- TR-CODE values (p.3): 1 = HOLDER, 2 = PROPERTY, 3 = PROPADD (additional owner), 5 = SECURITY, 6 = TANGIBLE, 9 = SUMINFO. Codes 4, 7 and 8 are reserved.
- Field classes (p.3): **M** = mandatory (the file is rejected if missing), **R** = required if known, **O** = optional.
- Record order (p.4): one HOLDER record comes first. All PROPERTY, PROPADD, SECURITY and TANGIBLE records that follow belong to it. SUMINFO comes last. Several holders may share one file as repeated HOLDER…SUMINFO blocks.
- Money (pp. 8, 13): PROPERTY amount fields are 10 digits with 2 implied decimals ("$253 = 0000025300"). SUMINFO amounts are 12 digits with 2 implied decimals. Shares have 4 implied decimals.
- Dates: CCYY, MM and DD are separate numeric subfields. If only the month or year is known, use "01" for the unknown parts (p.8).

## HOLDER record, TR-CODE 1 (pp. 19–20)
| # | Field | Len | Pos | Type | Class | Values / notes |
|---|---|---|---|---|---|---|
| 1 | TR-CODE | 1 | 1-1 | N | M | "1" |
| 2 | HOLDER-TAXID | 9 | 2-10 | N | M | FEIN, no hyphens |
| 3 | HOLDER-TAXID-EXT | 4 | 11-14 | N | R | default "0001" (p.4) |
| 4 | HOLDER-RPT-YEAR | 4 | 15-18 | C | M | |
| 5 | HOLDER-RPT-TYPE | 1 | 19-19 | C | M | A = advertising (no money; "for states on a two-cycle reporting schedule"), R = remittance; T = test (p.5) |
| 6 | HOLDER-RPT-NUMBER | 2 | 20-21 | C | M | 01-99 |
| 7 | HOLDER-RPT-FORMAT | 1 | 22-22 | C | M | "R" only |
| 8 | HOLDER-SIC-CODE | 4 | 23-26 | N | R | 0111-9999 |
| 9 | HOLDER-INCORPORATED-STATE | 2 | 27-28 | C | R | |
| 10a-c | HOLDER-INC-DATE CCYY/MM/DD | 4/2/2 | 29-32 / 33-34 / 35-36 | N | R | |
| 11 | HOLDER-NAME | 40 | 37-76 | C | M | A-Z/0-9/space/&, no punctuation |
| 12 | HOLDER-CITY | 30 | 77-106 | C | R | |
| 13 | HOLDER-COUNTY | 20 | 107-126 | C | R | |
| 14 | HOLDER-STATE | 2 | 127-128 | C | R | |
| 15a | HOLDER-CONTACT1-NAME | 40 | 129-168 | C | M | |
| 15b-d | HOLDER-CONTACT1-ADDR1/2/3 | 30 each | 169-198 / 199-228 / 229-258 | C | M | |
| 15e | HOLDER-CONTACT1-CITY | 30 | 259-288 | C | M | |
| 15f | HOLDER-CONTACT1-STATE | 2 | 289-290 | C | M | |
| 15g | HOLDER-CONTACT1-ZIP | 9 | 291-299 | C | M | left-justify, space-fill |
| 15h | HOLDER-CONTACT1-COUNTRY | 3 | 300-302 | C | M | ISO 3-letter |
| 15i1-3 | CONTACT1 TEL AC / NBR / EXT | 3/7/4 | 303-305 / 306-312 / 313-316 | N/N/C | M/M/O | |
| 15j | HOLDER-CONTACT1-EMAIL | 50 | 317-366 | C | O | |
| 16a | HOLDER-CONTACT2-NAME | 40 | 367-406 | C | O | claims contact |
| 16b-d | HOLDER-CONTACT2-ADDR1/2/3 | 30 each | 407-436 / 437-466 / 467-496 | C | O | |
| 16e | HOLDER-CONTACT2-CITY | 30 | 497-526 | C | O | |
| 16f | HOLDER-CONTACT2-STATE | 2 | 527-528 | C | O | |
| 16g | HOLDER-CONTACT2-ZIP | 9 | 529-537 | C | O | |
| 16h | HOLDER-CONTACT2-COUNTRY | 3 | 538-540 | C | O | |
| 16i1-3 | CONTACT2 TEL AC / NBR / EXT | 3/7/4 | 541-543 / 544-550 / 551-554 | N/N/C | O | |
| 16j | HOLDER-CONTACT2-EMAIL | 50 | 555-604 | C | O | |
| 17 | HOLDER-FAX AC / NBR | 3/7 | 605-607 / 608-614 | N | O | |
| 18 | HOLDER-NAICS-CODE | 6 | 615-620 | C | R | |
| 19 | FILLER | 5 | 621-625 | C | M | spaces |

## PROPERTY record, TR-CODE 2 (pp. 20–22)
| # | Field | Len | Pos | Type | Class | Values / notes |
|---|---|---|---|---|---|---|
| 1 | TR-CODE | 1 | 1-1 | N | M | 2 |
| 2 | PROP-SEQUENCE-NUMBER | 6 | 2-7 | N | M | 000001-999999, unique |
| 3 | PROP-OWNER-TYPE | 1 | 8-8 | C | M | P |
| 4 | PROP-NAME-ID | 1 | 9-9 | C | M | C (business name) or space |
| 5 | PROP-OWNER-NAME-LAST | 40 | 10-49 | C | M | |
| 6 | PROP-OWNER-NAME-FIRST | 30 | 50-79 | C | R | |
| 7 | PROP-OWNER-NAME-MIDDLE | 10 | 80-89 | C | R | |
| 8 | PROP-OWNER-NAME-PREFIX | 10 | 90-99 | C | R | |
| 9 | PROP-OWNER-NAME-SUFFIX | 10 | 100-109 | C | R | |
| 10 | PROP-OWNER-NAME-TITLE | 6 | 110-115 | C | R | |
| 11a-c | PROP-OWNER-ADDRESS1/2/3 | 30 each | 116-145 / 146-175 / 176-205 | C | R | |
| 12 | PROP-OWNER-CITY | 30 | 206-235 | C | R | |
| 13 | PROP-OWNER-COUNTY | 20 | 236-255 | C | O | |
| 14 | PROP-OWNER-STATE | 2 | 256-257 | C | R | |
| 15 | PROP-OWNER-ZIP | 9 | 258-266 | C | R | |
| 16 | PROP-OWNER-COUNTRY | 3 | 267-269 | C | R | |
| 17 | PROP-OWNER-TAXID | 9 | 270-278 | N | R | SSN/FEIN |
| 18 | PROP-OWNER-TAXID-EXT | 2 | 279-280 | C | O | |
| 19a-c | PROP-OWNER-DOB CCYY/MM/DD | 4/2/2 | 281-284 / 285-286 / 287-288 | N | O | |
| 20a-c | PROP-ST-TRANS-DATE CCYY/MM/DD | 4/2/2 | 289-292 / 293-294 / 295-296 | N | R | last-activity date, e.g. "issue date of a check" (p.8) |
| 21a-c | PROP-EN-TRANS-DATE CCYY/MM/DD | 4/2/2 | 297-300 / 301-302 / 303-304 | N | O | periodic payments only |
| 22 | PROP-PROPERTY-TYPE | 4 | 305-308 | C | R | e.g. CK13, MS01 |
| 23 | PROP-AMOUNT-REPORTED | 10 | 309-318 | N | M | gross, 2 implied decimals |
| 24 | PROP-DEDUCTION-TYPE | 2 | 319-320 | C | M if deduction > 0 | DW, IW, MC, SW, TW, ZZ (p.14) |
| 25 | PROP-DEDUCTION-AMOUNT | 10 | 321-330 | N | M | not negative |
| 26 | PROP-AMOUNT-ADVERTISED | 10 | 331-340 | N | M | reported minus deduction |
| 27 | PROP-ADDITION-TYPE | 2 | 341-342 | C | R if addition > 0 | DR, DV, IN, ME, SP, ZZ (p.15) |
| 28 | PROP-ADDITION-AMOUNT | 10 | 343-352 | N | M | |
| 29 | PROP-DELETION-TYPE | 2 | 353-354 | C | R if deletion > 0 | ER, RO, RS, ZZ (p.15) |
| 30 | PROP-DELETION-AMOUNT | 10 | 355-364 | N | M | |
| 31 | PROP-AMOUNT-REMITTED | 10 | 365-374 | N | M if cash | |
| 32 | PROP-INTEREST-FLAG | 1 | 375-375 | C | M if interest-bearing | |
| 33 | PROP-INTEREST-RATE | 7 | 376-382 | N | R if flag = Y | 4 implied decimals |
| 34-39 | STOCK-ISSUE-NAME(25) / CUSIP(9) / NUMBER-OF-SHARES(12) / ADD-(12) / DEL-(12) / REM-SHARES(12) | | 383-407 / 408-416 / 417-428 / 429-440 / 441-452 / 453-464 | C/C/N/N/N/N | R if security | shares have 4 implied decimals |
| 40-42 | UNEXCHANGED-ISSUE-NAME(25) / CUSIP(9) / SHARES(12) | | 465-489 / 490-498 / 499-510 | C/C/N | R if unexchanged | |
| 43 | PROP-ACCT-NUMBER | 20 | 511-530 | C | O | |
| 44 | PROP-CHECK-NUMBER | 20 | 531-550 | C | O | |
| 45 | PROP-DESCRIPTION | 50 | 551-600 | C | O | |
| 46 | PROP-RELATIONSHIP-CODE | 2 | 601-602 | C | M | e.g. SO sole owner, PA payee, UN unknown (pp.15–16) |
| 47 | PROP-OWNER-TYPE-CODE | 2 | 603-604 | C | M | AP aggregate, OT named owner, UN unknown owner (p.18) |
| 48 | FILLER | 21 | 605-625 | C | M | spaces |

## PROPADD (additional owner) record, TR-CODE 3 (p. 22)
Positions run 1-1 TR-CODE "3", 2-7 PADD-SEQUENCE-NUMBER (= PROP-SEQUENCE-NUMBER), 8-8 PADD-OWNER-TYPE "A", 9-48 NAME-LAST(40), 49-78 FIRST(30), 79-88 MIDDLE(10), 89-98 PREFIX(10), 99-108 SUFFIX(10), 109-114 TITLE(6), 115-144 ADDRESS1(30), 145-174 ADDRESS2(30), ADDRESS3(30), 205-234 CITY(30), 235-254 COUNTY(20), 255-256 STATE(2), 257-265 ZIP(9), 266-268 COUNTRY(3), 269-277 TAXID(9, C), 278-279 TAXID-EXT(2), 280-287 DOB(CCYY/MM/DD), 288-289 RELATIONSHIP-CODE(2, M), PADD-SEQ-NUMBER(3, N, M, starts at 1), 293-294 OWNER-TYPE-CODE(2, M), 295-295 NAME-ID(1), 296-625 FILLER(330).
**Errata in the official PDF:** ADDRESS3 is printed as "174-204" and should be 175-204. PADD-SEQ-NUMBER is printed as "290-282" and should be 290-292. The corrected values follow from the field lengths, but they are inferred.

## SECURITY (TR 5) and TANGIBLE (TR 6) records (p. 23)
Both are out of v1 scope. Their layouts are on p.23. SECURITY covers SUBISSUE-NAME 8-157, ORIGINAL-SHRS-HELD, REG-NAME, DELIVERY-METHOD 240-249 (M) and the rest, with FILLER 350-625. TANGIBLE covers box number, description and dates, with FILLER 230-625.

## SUMINFO (summary) record, TR-CODE 9 (p. 24; definitions pp. 13–14)
| # | Field | Len | Pos | Type | Class | Notes |
|---|---|---|---|---|---|---|
| 1 | TR-CODE | 1 | 1-1 | N | M | 9 |
| 2 | SUMM-NBR-OF-RECORDS | 6 | 2-7 | N | M | total records including HOLDER, PROPERTY, PROPADD and SUMINFO. A 2-record file is a negative report (p.13). ACS Wagers (vendor) also counts SECURITY/TANGIBLE |
| 3 | SUMM-NBR-OF-PROPERTIES | 6 | 8-13 | N | M | count of PROPERTY records |
| 4 | SUMM-AMOUNT-REPORTED | 12 | 14-25 | N | M | sum of field 23, 2 implied decimals |
| 5 | SUMM-DEDUCTION-AMOUNT | 12 | 26-37 | N | M | |
| 6 | SUMM-AMOUNT-ADVERTISED | 12 | 38-49 | N | M | |
| 7 | SUMM-ADDITION-AMOUNT | 12 | 50-61 | N | M | |
| 8 | SUMM-DELETION-AMOUNT | 12 | 62-73 | N | M | |
| 9 | SUMM-AMOUNT-REMITTED | 12 | 74-85 | N | M | |
| 10-13 | SUMM-NBR-OF-SHARES / SHARES-ADD / SHARES-DEL / SHARES-REMITTED | 14 each | 86-99 / 100-113 / 114-127 / 128-141 | N | M | 4 implied decimals |
| 14 | SUMM-NEGATIVE-REPORT | 1 | 142-142 | C | O | Y or space |
| 15 | SUMM-SOFTWARE-VERSION | 20 | 143-162 | C | M | |
| 16 | SUMM-CREATOR | 20 | 163-182 | C | M | |
| 17 | SUMM-CREATOR-CONTACT | 70 | 183-252 | C | M | |
| 18 | FILLER | (373) | (253-625) | C | | "Space fill" (p.14). The p.24 table ends at field 17, so the length and positions shown are **inferred** from the 625-byte record length |

## v1 property type codes (NAUPA list, p.17)
CK01 Cashier's Checks · **CK13 Vendor Checks** · CK99 Aggregate Uncashed Checks · **MS01 Wages, Payroll, Salary** · **MS04 Payments For Goods & Services** · MS05 Customer Overpayments · **MS06 Unidentified Remittances** · MS08 Accounts Payable · **MS09 Credit Balance -- Accounts Receivable** · MS11 Refunds Due · MS16 Miscellaneous Outstanding Checks · MS99 Aggregate Misc Property. Page 14 adds: "Individual States may require different codes."

## Which states accept which version
| State | Accepts | Source |
|---|---|---|
| CA | NAUPA II, uploaded at GoReport.sco.ca.gov (or manual report) | SCO Notice Report Checklist: "in National Association of Unclaimed Property Administrators (NAUPA II) format"; NAUPA CA page: "NAUPA 2 Format: Yes", NAUPA 3 blank |
| DE | NAUPA II only, via web portal; file extension .rpt, .txt or .hrs; manual entry advised for ≤ 10 properties | DE Holder Handbook Aug 2026 pp.15–17; 12 Del. C. §1142(a) (web-based only since 2018-03-01) |
| TX | "NAUPA2 formatted file" via ClaimItTexas.gov secure file transfer, max 250 MB; Manual Online Reporting for small reports | TX 2026 Reporting Instructions pp.4, 9 (PDF pp.10, 15) |

**State-specific deviations seen:**
- HOLDER-RPT-TYPE: CA is a two-cycle state. Whether CA expects "A" on the Notice Report and "R" on the Remit Report was **not confirmed** in SCO materials. SCO says both are "NAUPA II" files, and the Remit Report is an updated version of the notice file.
- Aggregate owner-type code: DE Handbook p.39 lists `AG`, while the NAUPA spec p.18 lists `AP`. Using `AG` would also clash with relationship code AG (Agent For).
- TX: the aggregate type code must end in "99". Holders deduct mailing cost with deduction code `MC` (instructions p.8). Last-contact date and relationship code are mandatory, or the report is rejected.

## NAUPA III (not yet in production)
Per https://unclaimed.org/naupa3/ (retrieved 2026-10-29), NAUPA III moves "from the fixed width format to Extensible Markup Language (XML)". NAUPA says: "While we initially targeted a Fall 2026 start … we are shifting to a two-phase rollout. Phase 1: Spring 2027." The draft is "Version 1.4 - April 2026" (NAUPA-III-File-Draft-1.4-May-2026.pdf). That draft was not analyzed. None of the CA, DE or TX pages lists NAUPA 3 as accepted.

## Could not confirm
- The exact length and positions of SUMINFO FILLER. The table omits the row, so 253-625 is inferred.
- The corrected PROPADD positions noted under errata above.
- Whether CA requires HOLDER-RPT-TYPE "A" for Notice Reports.
- Any state-specific holder-record additions, such as a DE or TX report-type code.
- The 2019 copy of the spec that the DE handbook cites. Its differences from the 1.29.25 file were not compared.
