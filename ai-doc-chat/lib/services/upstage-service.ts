/**
 * Upstage Document Parse Service
 * Parses PDFs using Upstage API
 */

import { config } from '../aws-config';

export interface UpstageParseResult {
  content: string;
  metadata: {
    pages: number;
    tables: number;
    charts: number;
  };
}

/**
 * Parse PDF with Upstage (Synchronous with Timeout)
 * Directly returns the parsed result
 * 
 * Supports:
 * - Max 50MB file size
 * - Max 100 pages (sync API limit)
 * - Chart recognition (bar, line, pie charts)
 * - Table extraction with multi-page merge
 * - Equation recognition (LaTeX format)
 * 
 * Timeout: 3 minutes (configurable via UPSTAGE_TIMEOUT_MS)
 */
export async function parseDocumentWithUpstage(pdfUrl: string): Promise<UpstageParseResult> {
  const timeout = parseInt(process.env.UPSTAGE_TIMEOUT_MS || '180000', 10); // 3 minutes default
  
  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Fetch the PDF from S3
    const pdfResponse = await fetch(pdfUrl, { signal: controller.signal });
    const pdfBlob = await pdfResponse.blob();
    
    // Create form data
    const formData = new FormData();
    formData.append('document', pdfBlob, 'document.pdf');
    formData.append('ocr', 'force'); // Force OCR for all documents
    formData.append('model', 'document-parse'); // Use stable alias
    
    // Enable multi-page table merging for better table extraction
    formData.append('merge_multipage_tables', 'true');

    // Call synchronous API with timeout
    const response = await fetch('https://api.upstage.ai/v1/document-digitization', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.upstage.apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upstage API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    
    // Parse and return result
    return parseUpstageResult(result);
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Upstage API request timed out after ${timeout}ms. Try a smaller document or contact support.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse Upstage result into our format
 */
export function parseUpstageResult(result: any): UpstageParseResult {
  // Extract metadata from Upstage response
  const tables = result.elements?.filter((e: any) => e.category === 'table').length || 0;
  const charts = result.elements?.filter((e: any) => e.category === 'chart').length || 0;
  const figures = result.elements?.filter((e: any) => e.category === 'figure').length || 0;
  
  // Get total pages from elements
  const pages = result.elements?.length > 0 
    ? Math.max(...result.elements.map((e: any) => e.page || 1))
    : 1;
  
  return {
    content: result.content?.html || result.content?.markdown || result.content?.text || '',
    metadata: {
      pages,
      tables,
      charts: charts + figures,
    },
  };
}

/**
 * Format Upstage output for Bedrock KB
 * Adds markers for tables and charts to improve RAG retrieval
 * 
 * Upstage provides structured HTML with:
 * - <table> tags for tables
 * - <figure data-category="chart"> for charts with extracted data
 * - <p data-category="equation"> for LaTeX equations
 * - Layout categories: heading1, paragraph, list, etc.
 */
export function formatForBedrockKB(content: string): string {
  let formatted = content;
  
  // Add markers for tables (already in HTML <table> format from Upstage)
  formatted = formatted.replace(
    /<table[^>]*>([\s\S]*?)<\/table>/gi,
    (_match, tableContent) => `\n**[TABLE]**\n<table>${tableContent}</table>\n`
  );
  
  // Add markers for charts (Upstage uses <figure data-category="chart">)
  formatted = formatted.replace(
    /<figure[^>]*data-category=['"]chart['"][^>]*>([\s\S]*?)<\/figure>/gi,
    (_match, figureContent) => `\n**[CHART]**\n<figure>${figureContent}</figure>\n`
  );
  
  // Add markers for equations (Upstage uses <p data-category="equation">)
  formatted = formatted.replace(
    /<p[^>]*data-category=['"]equation['"][^>]*>([\s\S]*?)<\/p>/gi,
    (_match, equationContent) => `\n**[EQUATION]**\n${equationContent}\n`
  );
  
  return formatted;
}
