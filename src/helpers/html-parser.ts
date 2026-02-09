import * as cheerio from 'cheerio';

/**
 * HTML解析工具类
 * 
 * 提供通用的HTML解析方法，供数据源使用
 * 不强制修改现有数据源，保持系统稳定性
 * 
 * 使用示例（供新数据源参考）：
 * 
 * ```typescript
 * import { HTMLParser } from '../../helpers/html-parser';
 * 
 * export const newSourceConfig: DataSourceConfig = {
 *   name: 'newsource',
 *   url: 'https://example.com',
 *   interval: 3000,
 *   parser: (html: string) => {
 *     const qihao = HTMLParser.extractText(html, '.issue');
 *     const opennum = HTMLParser.extractText(html, '.numbers');
 *     const opentime = HTMLParser.extractText(html, '.time');
 *     
 *     if (!qihao || !opennum || !opentime) return null;
 *     
 *     const sum_value = opennum.split('+').reduce((a, b) => a + parseInt(b), 0);
 *     return { qihao, opennum, opentime, sum_value, source: 'newsource' };
 *   }
 * };
 * ```
 * 
 * 注意：现有7个数据源保持不变，此工具仅供新数据源使用
 */
export class HTMLParser {
  /**
   * 通过CSS选择器提取文本
   * 
   * @param html HTML字符串
   * @param selector CSS选择器
   * @returns 提取的文本，失败返回null
   * 
   * @example
   * ```typescript
   * const qihao = HTMLParser.extractText(html, '.issue-number');
   * ```
   */
  static extractText(html: string, selector: string): string | null {
    try {
      const $ = cheerio.load(html);
      return $(selector).text().trim() || null;
    } catch {
      return null;
    }
  }
  
  /**
   * 通过CSS选择器提取属性
   * 
   * @param html HTML字符串
   * @param selector CSS选择器
   * @param attr 属性名
   * @returns 提取的属性值，失败返回null
   * 
   * @example
   * ```typescript
   * const url = HTMLParser.extractAttr(html, 'a.link', 'href');
   * ```
   */
  static extractAttr(html: string, selector: string, attr: string): string | null {
    try {
      const $ = cheerio.load(html);
      return $(selector).attr(attr) || null;
    } catch {
      return null;
    }
  }
  
  /**
   * 通过正则表达式提取JSON
   * 
   * @param html HTML字符串
   * @param pattern 正则表达式（需要包含捕获组）
   * @returns 解析的JSON对象，失败返回null
   * 
   * @example
   * ```typescript
   * const data = HTMLParser.extractJSON(html, /var data = ({.*?});/);
   * ```
   */
  static extractJSON(html: string, pattern: RegExp): any {
    try {
      const match = html.match(pattern);
      if (!match || !match[1]) return null;
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
  
  /**
   * 提取表格数据
   * 
   * @param html HTML字符串
   * @param tableSelector 表格CSS选择器
   * @returns 二维数组，每行为一个数组，失败返回空数组
   * 
   * @example
   * ```typescript
   * const rows = HTMLParser.extractTable(html, 'table.data');
   * // rows = [['期号', '号码', '时间'], ['2025001', '1+2+3', '12:00'], ...]
   * ```
   */
  static extractTable(html: string, tableSelector: string): string[][] {
    try {
      const $ = cheerio.load(html);
      const rows: string[][] = [];
      $(tableSelector).find('tr').each((_, row) => {
        const cells: string[] = [];
        $(row).find('td, th').each((_, cell) => {
          cells.push($(cell).text().trim());
        });
        if (cells.length > 0) rows.push(cells);
      });
      return rows;
    } catch {
      return [];
    }
  }
  
  /**
   * 提取多个元素的文本
   * 
   * @param html HTML字符串
   * @param selector CSS选择器
   * @returns 文本数组，失败返回空数组
   * 
   * @example
   * ```typescript
   * const numbers = HTMLParser.extractMultipleTexts(html, '.number');
   * // numbers = ['1', '2', '3']
   * ```
   */
  static extractMultipleTexts(html: string, selector: string): string[] {
    try {
      const $ = cheerio.load(html);
      const texts: string[] = [];
      $(selector).each((_, element) => {
        const text = $(element).text().trim();
        if (text) texts.push(text);
      });
      return texts;
    } catch {
      return [];
    }
  }
}





