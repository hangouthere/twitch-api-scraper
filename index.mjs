import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import ObjectsToCsv from 'objects-to-csv';

const TwitchReferenceURL = 'https://dev.twitch.tv/docs/api/reference';
const URLHelixBase = 'https://api.twitch.tv/helix/';
const FileNameCache = '.cache.twitch-reference.html';
const FileNameCSV = 'endpoints.csv';

/**
 * @type {string}
 */
let content;

/**
 * @type {cheerio.Root}
 */
let $;

async function getReferenceContent() {
  const resp = await fetch(TwitchReferenceURL);
  const content = await resp.text();

  await fs.writeFile(FileNameCache, content);
}

async function loadReferenceContent() {
  try {
    await fs.stat(FileNameCache);
  } catch {
    await getReferenceContent();
  }

  content = await fs.readFile(FileNameCache);
}

async function start() {
  await loadReferenceContent();

  $ = cheerio.load(content);

  const endpoints = processContent();

  console.log(`Found ${endpoints.length} Endpoints`);

  writeCSV(endpoints);
}

function processContent() {
  const endpoints = [];

  // Start with each main section
  $('body > div.main > section.doc-content').each((_idx, element) => {
    // Get Title
    const titleHeader = $(element).find('.left-docs h2');
    const title = titleHeader.text();
    const docsLink = TwitchReferenceURL + '#' + $(titleHeader).attr('id');

    if (!title) {
      return;
    }

    // Get Description
    const description = $(element).find('p').first().text();

    // Grab some sections
    const authHeader = $(element).find('h3:contains("Authorization")');
    const urlHeader = $(element).find('h3:contains("URL")');
    const requestQueryParamHeader = $(element).find('h3:contains("Request Query Parameters")');
    const requestBodyHeader = $(element).find('h3:contains("Request Body")');
    const responseBodyHeader = $(element).find('h3:contains("Response Body")');

    // Parse Auth Token Requirements
    const authContent = authHeader.next('p');
    const tokenTypes = {};
    let currTokenType;
    authContent.children().each((_idx, element) => {
      let $elem = $(element);
      // Auth token types are presented as <a> tags
      if ($elem.is('a')) {
        let aText = $elem.text().toLowerCase();
        currTokenType = aText.includes('app') ? 'App Token' : aText.includes('user') ? 'User Token' : null;
      }

      if (currTokenType) {
        tokenTypes[currTokenType] = true;
      }

      // Permissions are presented in <strong> tags
      if (currTokenType && $elem.is('strong')) {
        tokenTypes[currTokenType] = Array.isArray(tokenTypes[currTokenType]) ? tokenTypes[currTokenType] : [];
        tokenTypes[currTokenType].push($elem.text());
      }
    });

    // Parse URL Info
    const urlContent = urlHeader.next('p').find('code').text();
    let [httpMethod, endpoint] = urlContent.split(' ');
    // Bad Docs! They didn't give the HTTP Method :S
    if (httpMethod && !endpoint) {
      endpoint = httpMethod;
      httpMethod = 'GET';
    }
    // Strip the URL of the base URL to get just the endpoint name
    endpoint = endpoint.replace(URLHelixBase, '');

    // Parse Request Query Parameters
    const reqQueryContent = requestQueryParamHeader.next('table').find('tbody tr');
    const requestParams = [];
    reqQueryContent.each((_idx, element) => {
      const cells = $(element).children();
      requestParams.push({
        parameter: $(cells.get(0)).text(),
        type: $(cells.get(1)).text(),
        required: $(cells.get(2)).text().includes('Yes'),
        description: $(cells.get(3)).text().replace('Read More', '').trim()
      });
    });

    // Parse Request Body Parameters
    const reqBodyContent = requestBodyHeader.next('table').find('tbody tr');
    const bodyParams = [];
    reqBodyContent.each((_idx, element) => {
      const cells = $(element).children();
      bodyParams.push({
        field: $(cells.get(0)).text(),
        type: $(cells.get(1)).text(),
        description: $(cells.get(2)).text().replace('Read More', '').trim()
      });
    });

    // Parse Response Body Parameters
    const respBodyContent = responseBodyHeader.next('table').find('tbody tr');
    const respParams = [];
    respBodyContent.each((_idx, element) => {
      const cells = $(element).children();
      respParams.push({
        field: $(cells.get(0)).text(),
        type: $(cells.get(1)).text(),
        description: $(cells.get(2)).text().replace('Read More', '').trim()
      });
    });

    // Parse Examples
    const rightSection = $(element).find('.right-code');
    const examples = [];
    let currExample;
    rightSection.children().each((_idx, element) => {
      let $elem = $(element);
      // Element is an Exmaple Request
      if ($elem.is('h3') && $elem.text().includes('Request')) {
        currExample = {
          description: $elem.next('p').text(),
          request: $elem.next('pre code').text()
        };
      }

      if (currExample && $elem.is('h3') && $elem.text().includes('Response')) {
        currExample['response'] = $elem.next('div').text();
        examples.push(currExample);
        currExample = null;
      }
    });

    endpoints.push({
      docsLink,
      title,
      description,
      tokenTypes,
      endpoint: {
        httpMethod,
        endpoint,
        fullPath: `${URLHelixBase}${endpoint}`
      },
      requestParams,
      bodyParams,
      respParams,
      examples
    });
  });

  return endpoints;
}

async function writeCSV(endpoints) {
  const csv = new ObjectsToCsv(endpoints);
  await csv.toDisk(FileNameCSV);
}

start();
