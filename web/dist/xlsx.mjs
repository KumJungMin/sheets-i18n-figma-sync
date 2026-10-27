const UTF8_DECODER = new TextDecoder("utf-8"); const XLSX_ACCEPTED_EXTENSIONS = [".xlsx"];
      function normalizeHeaderCell(value) {
        return String(value || "")
          .replace(/^\uFEFF/, "")
          .trim()
          .toLowerCase();
      }
      function isNonEmptyTableRow(row) {
        return Array.isArray(row)
          ? row.some((value) => String(value || "").trim().length > 0)
          : false;
      }
      function findHeaderRowIndex(rows) {
        const searchLimit = Math.min(rows.length, 10);
        for (let rowIndex = 0; rowIndex < searchLimit; rowIndex += 1) {
          const normalizedRow = rows[rowIndex].map(normalizeHeaderCell);
          if (normalizedRow.indexOf("key") >= 0) {
            return rowIndex;
          }
        }
        return -1;
      }
      function isRepeatedHeaderRow(row, keyIndex, languageColumns) {
        if (normalizeHeaderCell(row[keyIndex]) !== "key") return false;
        return languageColumns.every(
          (column) => normalizeHeaderCell(row[column.index]) === column.lang,
        );
      }
      function parseTranslationTableRows(rows, options) {
        const compactRows = Array.isArray(rows)
          ? rows
              .filter(isNonEmptyTableRow)
              .map((row) => row.map((value) => (value == null ? "" : String(value))))
          : [];
        if (compactRows.length < 2) {
          throw new Error(
            (options && options.sourceLabel
              ? options.sourceLabel
              : "번역 데이터") + "에는 헤더와 최소 한 개의 데이터 행이 필요합니다.",
          );
        }

        const headerRowIndex = findHeaderRowIndex(compactRows);
        if (headerRowIndex < 0) {
          throw new Error('"key" 컬럼을 찾을 수 없습니다.');
        }

        const headerRow = compactRows[headerRowIndex];
        const normalizedHeaderRow = headerRow.map(normalizeHeaderCell);
        const keyIndex = normalizedHeaderRow.indexOf("key");
        const languageColumns = normalizedHeaderRow
          .map((lang, index) =>
            index !== keyIndex && lang ? { index: index, lang: lang } : null,
          )
          .filter(Boolean);
        if (!languageColumns.length) {
          throw new Error("언어 컬럼을 찾을 수 없습니다.");
        }

          const translations = Object.create(null);
        for (
          let rowIndex = headerRowIndex + 1;
          rowIndex < compactRows.length;
          rowIndex += 1
        ) {
          const row = compactRows[rowIndex];
          if (isRepeatedHeaderRow(row, keyIndex, languageColumns)) continue;

          const key = String(row[keyIndex] || "").trim();
          if (!key) continue;

            const entry = Object.create(null);
          languageColumns.forEach((column) => {
            entry[column.lang] = row[column.index] || "";
          });
          translations[key] = entry;
        }

        return {
          translations: translations,
          languages: languageColumns.map((column) => column.lang),
        };
      }
      function readUint16(view, offset) {
        return view.getUint16(offset, true);
      }
      function readUint32(view, offset) {
        return view.getUint32(offset, true);
      }
      function decodeUtf8(bytes) {
        return UTF8_DECODER.decode(bytes);
      }
      function findEndOfCentralDirectoryOffset(view) {
        const minimumOffset = Math.max(0, view.byteLength - 65557);
        for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
          if (readUint32(view, offset) === 0x06054b50) {
            return offset;
          }
        }
        throw new Error("유효하지 않은 XLSX 파일입니다. ZIP 종료 레코드를 찾을 수 없습니다.");
      }
      function readZipEntries(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const endOfCentralDirectoryOffset =
          findEndOfCentralDirectoryOffset(view);
        const centralDirectorySize = readUint32(
          view,
          endOfCentralDirectoryOffset + 12,
        );
        const centralDirectoryOffset = readUint32(
          view,
          endOfCentralDirectoryOffset + 16,
        );
        const entries = new Map();
        let offset = centralDirectoryOffset;
        const directoryEnd = centralDirectoryOffset + centralDirectorySize;

        while (offset < directoryEnd) {
          if (readUint32(view, offset) !== 0x02014b50) {
            throw new Error("유효하지 않은 XLSX 파일입니다. ZIP 중앙 디렉터리가 손상되었습니다.");
          }

          const compressionMethod = readUint16(view, offset + 10);
          const compressedSize = readUint32(view, offset + 20);
          const fileNameLength = readUint16(view, offset + 28);
          const extraFieldLength = readUint16(view, offset + 30);
          const commentLength = readUint16(view, offset + 32);
          const localHeaderOffset = readUint32(view, offset + 42);
          const fileName = decodeUtf8(
            new Uint8Array(arrayBuffer, offset + 46, fileNameLength),
          );

          entries.set(fileName, {
            compressionMethod: compressionMethod,
            compressedSize: compressedSize,
            localHeaderOffset: localHeaderOffset,
          });

          offset += 46 + fileNameLength + extraFieldLength + commentLength;
        }

        return entries;
      }
      async function inflateZipEntry(compressedBytes) {
        if (typeof DecompressionStream !== "function") {
          throw new Error(
              "현재 브라우저에서는 XLSX 압축 해제를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.",
          );
        }

        const compressedBuffer = compressedBytes.buffer.slice(
          compressedBytes.byteOffset,
          compressedBytes.byteOffset + compressedBytes.byteLength,
        );
        const algorithms = ["deflate-raw", "deflate"];
        let lastError = null;

        for (let i = 0; i < algorithms.length; i += 1) {
          try {
            const stream = new Blob([compressedBuffer])
              .stream()
              .pipeThrough(new DecompressionStream(algorithms[i]));
            return new Uint8Array(await new Response(stream).arrayBuffer());
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError || new Error("XLSX 데이터를 압축 해제하지 못했습니다.");
      }
      async function readZipEntryBytes(arrayBuffer, entries, path) {
        const entry = entries.get(path);
        if (!entry) {
          throw new Error("XLSX 내부 항목이 없습니다: " + path);
        }

        const view = new DataView(arrayBuffer);
        if (readUint32(view, entry.localHeaderOffset) !== 0x04034b50) {
          throw new Error("유효하지 않은 XLSX 파일입니다. ZIP 로컬 헤더가 손상되었습니다.");
        }

        const fileNameLength = readUint16(view, entry.localHeaderOffset + 26);
        const extraFieldLength = readUint16(view, entry.localHeaderOffset + 28);
        const dataOffset =
          entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength;
        const compressedBytes = new Uint8Array(
          arrayBuffer,
          dataOffset,
          entry.compressedSize,
        );

        if (entry.compressionMethod === 0) {
          return compressedBytes;
        }
        if (entry.compressionMethod !== 8) {
          throw new Error(
            "지원하지 않는 XLSX 압축 방식입니다: " + entry.compressionMethod,
          );
        }

        return inflateZipEntry(compressedBytes);
      }
      async function readZipEntryText(arrayBuffer, entries, path) {
        return decodeUtf8(await readZipEntryBytes(arrayBuffer, entries, path));
      }
      function parseXmlDocument(xmlText, label) {
        const document = new DOMParser().parseFromString(xmlText, "application/xml");
        if (document.getElementsByTagName("parsererror").length > 0) {
          throw new Error(label + " 파싱에 실패했습니다.");
        }
        return document;
      }
      function resolveArchivePath(basePath, targetPath) {
        const baseParts = basePath.split("/").slice(0, -1);
        const targetParts = String(targetPath || "").split("/");

        targetParts.forEach((part) => {
          if (!part || part === ".") return;
          if (part === "..") {
            baseParts.pop();
            return;
          }
          baseParts.push(part);
        });

        return baseParts.join("/");
      }
      function getAttributeValue(node, attributeName) {
        if (!node) return "";
        const directValue = node.getAttribute(attributeName);
        if (directValue != null) return directValue;

        for (let i = 0; i < node.attributes.length; i += 1) {
          const attribute = node.attributes[i];
          if (
            attribute.name === attributeName ||
            attribute.localName === attributeName ||
            attribute.nodeName === attributeName
          ) {
            return attribute.value;
          }
        }

        return "";
      }
      function parseSharedStrings(sharedStringsDocument) {
        return Array.from(sharedStringsDocument.getElementsByTagName("si")).map(
          (item) =>
            Array.from(item.getElementsByTagName("t"))
              .map((textNode) => textNode.textContent || "")
              .join(""),
        );
      }
      function cellReferenceToColumnIndex(reference) {
        const match = String(reference || "").match(/[A-Z]+/i);
        if (!match) return null;

        let columnIndex = 0;
        const letters = match[0].toUpperCase();
        for (let i = 0; i < letters.length; i += 1) {
          columnIndex = columnIndex * 26 + (letters.charCodeAt(i) - 64);
        }
        return columnIndex - 1;
      }
      function parseWorksheetCellValue(cellNode, sharedStrings) {
        const cellType = cellNode.getAttribute("t") || "";
        if (cellType === "inlineStr") {
          return Array.from(cellNode.getElementsByTagName("t"))
            .map((textNode) => textNode.textContent || "")
            .join("");
        }

        const valueNode = cellNode.getElementsByTagName("v")[0];
        const rawValue = valueNode ? valueNode.textContent || "" : "";
        if (cellType === "s") {
          const sharedStringIndex = Number(rawValue);
          return Number.isFinite(sharedStringIndex)
            ? sharedStrings[sharedStringIndex] || ""
            : "";
        }
        if (cellType === "b") {
          return rawValue === "1" ? "TRUE" : "FALSE";
        }

        return rawValue;
      }
      function extractWorksheetRows(worksheetDocument, sharedStrings) {
        return Array.from(worksheetDocument.getElementsByTagName("row")).map(
          (rowNode) => {
            const row = [];
            let nextColumnIndex = 0;

            Array.from(rowNode.getElementsByTagName("c")).forEach((cellNode) => {
              const columnIndex =
                cellReferenceToColumnIndex(cellNode.getAttribute("r")) ??
                nextColumnIndex;
              row[columnIndex] = parseWorksheetCellValue(cellNode, sharedStrings);
              nextColumnIndex = columnIndex + 1;
            });

            return row;
          },
        );
      }
      function resolveWorkbookSheets(workbookDocument, workbookRelsDocument) {
        const relationshipMap = new Map();
        Array.from(workbookRelsDocument.getElementsByTagName("Relationship")).forEach(
          (relationshipNode) => {
            const relationshipId = relationshipNode.getAttribute("Id");
            const targetPath = relationshipNode.getAttribute("Target");
            if (!relationshipId || !targetPath) return;
            relationshipMap.set(
              relationshipId,
              {
                path: resolveArchivePath("xl/workbook.xml", targetPath),
                type: relationshipNode.getAttribute("Type") || "",
              },
            );
          },
        );

        return Array.from(workbookDocument.getElementsByTagName("sheet"))
          .map((sheetNode, index) => {
            const relationshipId =
              getAttributeValue(sheetNode, "r:id") ||
              getAttributeValue(sheetNode, "id");
            const relationship = relationshipMap.get(relationshipId) || null;

            return {
              id: relationshipId || "sheet-" + index,
              name:
                sheetNode.getAttribute("name") ||
                (relationship && relationship.path) ||
                "워크시트 " + (index + 1),
              path: relationship ? relationship.path : "",
              relationshipType: relationship ? relationship.type : "",
              state: sheetNode.getAttribute("state") || "visible",
            };
          })
          .filter(Boolean);
      }
      async function inspectXlsxWorkbook(file) {
        const extension = "." + String(file.name || "").split(".").pop().toLowerCase();
        if (XLSX_ACCEPTED_EXTENSIONS.indexOf(extension) < 0) {
          throw new Error(".xlsx 파일을 업로드해 주세요.");
        }

        const arrayBuffer = await file.arrayBuffer();
        const entries = readZipEntries(arrayBuffer);
        const workbookDocument = parseXmlDocument(
          await readZipEntryText(arrayBuffer, entries, "xl/workbook.xml"),
          "workbook.xml",
        );
        const workbookRelsDocument = parseXmlDocument(
          await readZipEntryText(arrayBuffer, entries, "xl/_rels/workbook.xml.rels"),
          "workbook.xml.rels",
        );
        const sharedStrings = entries.has("xl/sharedStrings.xml")
          ? parseSharedStrings(
              parseXmlDocument(
                await readZipEntryText(arrayBuffer, entries, "xl/sharedStrings.xml"),
                "sharedStrings.xml",
              ),
            )
          : [];
        const visibleSheets = resolveWorkbookSheets(
          workbookDocument,
          workbookRelsDocument,
        ).filter((sheet) => sheet.state === "visible");
        if (!visibleSheets.length) {
          throw new Error("XLSX 파일에서 표시된 워크시트를 찾을 수 없습니다.");
        }

        const inspectedSheets = visibleSheets;
        const sheetCandidates = [];
        for (let i = 0; i < inspectedSheets.length; i += 1) {
          const sheet = inspectedSheets[i];

          try {
            if (!sheet.path) {
              throw new Error("워크시트 경로를 찾을 수 없습니다.");
            }
            const worksheetDocument = parseXmlDocument(
              await readZipEntryText(arrayBuffer, entries, sheet.path),
              sheet.name,
            );
            const data = parseTranslationTableRows(
              extractWorksheetRows(worksheetDocument, sharedStrings),
              { sourceLabel: 'Worksheet "' + sheet.name + '"' },
            );
            if (Object.keys(data.translations || {}).length === 0) {
              throw new Error("번역 키가 없습니다.");
            }
            data.sourceMeta = { sheetName: sheet.name, fileName: file.name };
            sheetCandidates.push({
              id: sheet.id,
              name: sheet.name,
              status: "valid",
              data: data,
              error: null,
            });
          } catch (error) {
            sheetCandidates.push({
              id: sheet.id,
              name: sheet.name,
              status: "invalid",
              data: null,
              error:
                error && error.message
                  ? error.message
                  : "워크시트를 읽지 못했습니다.",
            });
          }
        }

        return {
          fileName: file.name,
          activeSheetId: null,
          sheets: sheetCandidates,
          ignoredSheetCount: 0,
        };
      }

export { parseTranslationTableRows, inspectXlsxWorkbook };
