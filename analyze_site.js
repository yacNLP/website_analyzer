import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import fs from 'fs/promises';
import fetch from 'node-fetch';

/** ----------------------------
 *  Function: Analyze Performance with Lighthouse
 ---------------------------- */
 const analyzePerformance = async (url, browserWSEndpoint) => {
    console.log("Running Lighthouse analysis...");
    const { lhr } = await lighthouse(url, {
        port: new URL(browserWSEndpoint).port,
        output: 'json',
        logLevel: 'info',
    });

    // Vérifier que chaque catégorie existe avant d'accéder à `score`
    return {
        performance: lhr.categories.performance?.score ? lhr.categories.performance.score * 100 : null,
        seo: lhr.categories.seo?.score ? lhr.categories.seo.score * 100 : null,
        accessibility: lhr.categories.accessibility?.score ? lhr.categories.accessibility.score * 100 : null,
        bestPractices: lhr.categories['best-practices']?.score ? lhr.categories['best-practices'].score * 100 : null,
        pwa: lhr.categories['pwa']?.score ? lhr.categories['pwa'].score * 100 : null,
    };
};

/** ----------------------------
 *  Function: Check for Broken Links
 ---------------------------- */
const checkBrokenLinks = async (page) => {
    console.log("Checking for broken links...");
    const links = await page.$$eval('a', anchors => anchors.map(anchor => anchor.href));
    const brokenLinks = [];

    for (const link of links) {
        if (link.startsWith('mailto:') || link.startsWith('tel:')) continue; // Ignore mailto and tel links
        try {
            const response = await fetch(link);
            if (!response.ok) {
                brokenLinks.push({ link, status: response.status });
            }
        } catch (error) {
            brokenLinks.push({ link, error: error.message });
        }
    }

    return brokenLinks;
};

/** ----------------------------
 *  Function: Analyze Images
 ---------------------------- */
const analyzeImages = async (page) => {
    console.log("Analyzing images...");
    const images = await page.$$eval('img', imgs =>
        imgs.map(img => ({
            src: img.src,
            alt: img.alt || 'No alt attribute',
            size: null,
        }))
    );

    const heavyImages = [];
    for (const img of images) {
        try {
            const response = await fetch(img.src);
            if (response.ok) {
                img.size = parseInt(response.headers.get('content-length'), 10);
                if (img.size > 100000) heavyImages.push(img); // Images > 100KB
            }
        } catch {
            img.size = 'Error fetching image';
        }
    }

    return { images, heavyImages };
};

/** ----------------------------
 *  Function: Analyze Fonts
 ---------------------------- */
const analyzeFonts = async (page) => {
    console.log("Analyzing fonts...");
    const fonts = await page.evaluate(() => {
        const fontFaces = document.fonts;
        return Array.from(fontFaces).map(font => ({
            family: font.family,
            status: font.status,
        }));
    });
    return fonts;
};

/** ----------------------------
 *  Function: Analyze Security Headers
 ---------------------------- */
const analyzeSecurityHeaders = async (page, url) => {
    console.log("Checking security headers...");
    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        if (!response) {
            console.log("No response received for URL:", url);
            return ["No response received"];
        }

        console.log("Response received with status:", response.status());
        const headers = response.headers();
        if (!headers) {
            console.log("No headers available in the response.");
            return ["No headers available"];
        }

        const missingHeaders = [];
        if (!headers['strict-transport-security']) missingHeaders.push('Strict-Transport-Security');
        if (!headers['content-security-policy']) missingHeaders.push('Content-Security-Policy');
        if (!headers['x-frame-options']) missingHeaders.push('X-Frame-Options');

        return missingHeaders;
    } catch (error) {
        console.error("Error checking security headers:", error.message);
        return [`Error during security header check: ${error.message}`];
    }
};

/** ----------------------------
 *  Function: Analyze Redirects
 ---------------------------- */
const analyzeRedirects = async (page, url) => {
    console.log("Analyzing redirects...");
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (response.status() >= 300 && response.status() < 400) {
        const redirectedUrl = response.headers()['location'];
        return { originalUrl: url, redirectedUrl };
    }

    return null;
};

/** ----------------------------
 *  Function: Analyze Unused CSS/JS
 ---------------------------- */
const analyzeAssets = async (page) => {
    console.log("Analyzing assets...");
    const assets = [];
    page.on('response', async (response) => {
        const url = response.url();
        if (url.endsWith('.css') || url.endsWith('.js')) {
            const size = parseInt(response.headers()['content-length'] || 0, 10);
            assets.push({ url, size });
        }
    });

    await page.reload();
    const largeAssets = assets.filter(asset => asset.size > 50000); // Assets > 50 KB
    return largeAssets;
};

/** ----------------------------
 *  Function: Analyze Carbon Impact
 ---------------------------- */
const analyzeCarbonImpact = async (url) => {
    console.log("Analyzing carbon impact...");
    const response = await fetch(`https://api.websitecarbon.com/site?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    return data;
};

/** ----------------------------
 *  Main Function: Analyze Website
 ---------------------------- */
const analyzeSite = async (url) => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    const browserWSEndpoint = browser.wsEndpoint();

    try {
        console.log(`Starting analysis for: ${url}`);
        const results = {
            url,
            ...await analyzePerformance(url, browserWSEndpoint),
            brokenLinks: await checkBrokenLinks(page),
            images: await analyzeImages(page),
            fonts: await analyzeFonts(page),
            missingSecurityHeaders: await analyzeSecurityHeaders(page, url),
            redirects: await analyzeRedirects(page, url),
            largeAssets: await analyzeAssets(page),
            carbonImpact: await analyzeCarbonImpact(url),
        };

        const reportPath = './out/complete-analysis.json';
        await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
        console.log(`Analysis complete! Report saved to ${reportPath}`);
    } catch (error) {
        console.error("Error during analysis:", error);
    } finally {
        await browser.close();
    }
};

// Run the analysis
analyzeSite('https://depannage-remorquage44.fr/');
