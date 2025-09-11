#!/usr/bin/env node

// Import necessary modules from Node.js and external packages
import opentype from 'opentype.js';
import fs from 'fs';
import path from 'path';
import { decompress } from 'wawoff2';

/**
 * Processes a single font file, inspects it, and returns a CSS @font-face rule.
 * @param {string} fontPath - The absolute path to the font file.
 * @returns {Promise<string|null>} A promise that resolves to the CSS rule string, or null on failure.
 */
async function processFontFile(fontPath) {
  // Verify that the file actually exists before trying to open it.
  if (!fs.existsSync(fontPath)) {
    console.error(`Error: File not found at ${fontPath}`);
    return null;
  }

  console.log(`Inspecting font: ${fontPath}`);

  try {
    let font;
    const fileExtension = path.extname(fontPath).toLowerCase();

    // Check if the font is in WOFF2 format.
    if (fileExtension === '.woff2') {
      console.log('Detected .woff2 format, converting to TTF...');
      const woff2Buffer = fs.readFileSync(fontPath);
      const ttfBuffer = await decompress(woff2Buffer);
      const arrayBuffer = ttfBuffer.buffer.slice(
        ttfBuffer.byteOffset,
        ttfBuffer.byteOffset + ttfBuffer.byteLength
      );
      font = opentype.parse(arrayBuffer);
    } else {
      // For other font formats, load the file directly.
      font = opentype.loadSync(fontPath);
    }

    // Print font metrics and other details to the console.
    console.log('\nFont Metrics:');
    console.log('-------------');
    console.log(`- Units per Em: ${font.unitsPerEm}`);
    console.log(`- Ascender: ${font.ascender}`);
    console.log(`- Descender: ${font.descender}`);
    if (font.tables.hhea) console.log(`- Line Gap: ${font.tables.hhea.lineGap}`);
    if (font.tables.os2) {
      if (font.tables.os2.sCapHeight) console.log(`- Cap Height: ${font.tables.os2.sCapHeight}`);
      if (font.tables.os2.sxHeight) console.log(`- X-Height: ${font.tables.os2.sxHeight}`);
    }
    if (font.tables.head) {
        const { xMin, yMin, xMax, yMax } = font.tables.head;
        console.log(`- Bounding Box: (${xMin}, ${yMin}) to (${xMax}, ${yMax})`);
    }
    const isVariable = font.tables.fvar && font.tables.fvar.axes && font.tables.fvar.axes.length > 0;
    if (isVariable) {
      console.log('\nVariable Font Axes:');
      console.log('---------------------');
      font.tables.fvar.axes.forEach(axis => {
        console.log(`- Tag: '${axis.tag}', Range: ${axis.minValue} to ${axis.maxValue}, Default: ${axis.defaultValue}`);
      });
    }

    // Generate and return the CSS @font-face rule.
    if (font.tables.name && font.tables.os2 && font.tables.hhea) {
      const getEnglishName = (nameObject) => nameObject ? (nameObject.en || Object.values(nameObject)[0]) : 'Unknown';
      const fontFamily = getEnglishName(font.names.fontFamily);
      
      let fontWeight;
      let fontStyle;
      let fontVariationSettings = '';

      if (isVariable) {
        // For variable fonts, define ranges for weight and style if the axes exist.
        const weightAxis = font.tables.fvar.axes.find(axis => axis.tag === 'wght');
        fontWeight = weightAxis ? `${weightAxis.minValue} ${weightAxis.maxValue}` : font.tables.os2.usWeightClass;

        const slantAxis = font.tables.fvar.axes.find(axis => axis.tag === 'slnt');
        fontStyle = slantAxis ? `oblique ${slantAxis.minValue}deg ${slantAxis.maxValue}deg` : ((font.tables.os2.fsSelection & 1) ? 'italic' : 'normal');

        // Populate the font-variation-settings descriptor
        fontVariationSettings = font.tables.fvar.axes
          .map(axis => `'${axis.tag}' ${axis.defaultValue}`)
          .join(', ');

      } else {
        // For static fonts, use single values.
        fontWeight = font.tables.os2.usWeightClass;
        fontStyle = (font.tables.os2.fsSelection & 1) ? 'italic' : 'normal';
      }

      const ascentOverride = (font.ascender / font.unitsPerEm * 100).toFixed(4);
      const descentOverride = (Math.abs(font.descender) / font.unitsPerEm * 100).toFixed(4);
      const lineGapOverride = (font.tables.hhea.lineGap / font.unitsPerEm * 100).toFixed(4);

      // Build an array of CSS properties to ensure clean formatting.
      const cssProperties = [
        `  font-family: '${fontFamily}'`,
        `  src: url('${fontPath}')`,
        `  font-weight: ${fontWeight}`,
        `  font-style: ${fontStyle}`,
        `  font-display: swap`,
      ];
      
      if (fontVariationSettings) {
        cssProperties.push(`  font-variation-settings: ${fontVariationSettings}`);
      }

      cssProperties.push(`  ascent-override: ${ascentOverride}%`);
      cssProperties.push(`  descent-override: ${descentOverride}%`);
      cssProperties.push(`  line-gap-override: ${lineGapOverride}%`);

      // Join the properties into the final @font-face rule string.
      return `@font-face {\n${cssProperties.join(';\n')};\n}`;
    }
    return null; // Return null if required tables are missing.

  } catch (err) {
    console.error(`\nError: Could not parse ${fontPath}. It might be corrupted or in an unsupported format.`);
    console.error(`Details: ${err.message}`);
    return null; // Return null on parsing failure.
  }
}

/**
 * Main async function to orchestrate the processing of all font files.
 */
async function main() {
  // Get all command-line arguments after the script name.
  const fontPaths = process.argv.slice(2);

  // Check if any file paths were provided.
  if (fontPaths.length === 0) {
    console.error('Error: Please provide at least one path to a font file.');
    console.log('Usage: font-inspector /path/to/font1.woff2 /path/to/font2.ttf ...');
    process.exit(1);
  }

  const allCssRules = [];

  // Loop through each provided font path and process it.
  for (const relativePath of fontPaths) {
    const absoluteFontPath = path.resolve(relativePath);
    const cssRule = await processFontFile(absoluteFontPath);
    if (cssRule) {
      allCssRules.push(cssRule);
    }
    // Add a separator for cleaner console output between fonts.
    console.log('\n' + '-'.repeat(50) + '\n');
  }

  // After processing all fonts, write the collected CSS rules to a single file.
  if (allCssRules.length > 0) {
    const combinedCss = allCssRules.join('\n\n');
    const outputCssPath = path.resolve(process.cwd(), 'fonts.css');
    fs.writeFileSync(outputCssPath, combinedCss);
    console.log(`All CSS @font-face rules have been saved to: ${outputCssPath}`);
  } else {
    console.log('No valid fonts were processed, so no CSS file was generated.');
  }
}

// Run the main function.
main();
