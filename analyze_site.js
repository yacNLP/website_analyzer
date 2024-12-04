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

    // Capturer les réponses réseau
    page.on('response', async (response) => {
        const url = response.url();
        if (url.endsWith('.css') || url.endsWith('.js')) {
            const size = parseInt(response.headers()['content-length'] || 0, 10);
            assets.push({ url, size });
        }
    });

    try {
        // Recharger avec un timeout plus élevé
        await page.reload({ timeout: 60000, waitUntil: 'domcontentloaded' });
    } catch (error) {
        console.error("Error reloading the page for asset analysis:", error.message);
        return { assets, error: "Page reload timeout or failure" };
    }

    const largeAssets = assets.filter(asset => asset.size > 50000); // Assets > 50 KB
    return { assets, largeAssets };
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
 *  Analyze metadata
 ---------------------------- */
 const analyzeMetaData = async (page) => {
    console.log("Analyzing metadata...");
    try {
        const title = await page.title();
        
        // Vérifier la présence de meta description
        const metaDescription = await page.$eval(
            'meta[name="description"]',
            el => el.content
        ).catch(() => "No meta description found");

        // Vérifier la présence de Open Graph description
        const ogDescription = await page.$eval(
            'meta[property="og:description"]',
            el => el.content
        ).catch(() => "No Open Graph description found");

        // Vérifier la présence de Open Graph title
        const ogTitle = await page.$eval(
            'meta[property="og:title"]',
            el => el.content
        ).catch(() => "No Open Graph title found");

        return {
            title,
            metaDescription,
            ogTitle,
            ogDescription,
        };
    } catch (error) {
        console.error("Error analyzing metadata:", error.message);
        return {
            title: "Error fetching title",
            metaDescription: "Error fetching meta description",
            ogTitle: "Error fetching Open Graph title",
            ogDescription: "Error fetching Open Graph description",
        };
    }
};


/** ----------------------------
 *  Analyze cookies
 ---------------------------- */
 const analyzeCookies = async (page) => {
    console.log("Analyzing cookies...");
    const cookies = await page.cookies();
    return cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expires: cookie.expires === -1 ? 'Session' : new Date(cookie.expires * 1000).toISOString(),
    }));
};


/** ----------------------------
 *  Verify tiers Scripts
 ---------------------------- */
const analyzeThirdPartyResources = async (page) => {
    console.log("Analyzing third-party resources...");
    const thirdPartyResources = [];
    page.on('response', async (response) => {
        const url = response.url();
        if (!url.includes('yourdomain.com')) {
            thirdPartyResources.push(url);
        }
    });
    await page.reload();
    return thirdPartyResources;
};

/** ----------------------------
 *  Verify js Errors
 ---------------------------- */
const logJavaScriptErrors = (page) => {
    console.log("Logging JavaScript errors...");
    page.on('pageerror', error => {
        console.log("JavaScript error detected:", error.message);
    });
};

/** ----------------------------
 *  generate pdf
 ---------------------------- */
 const generatePDFReport = async (results, outputDir) => {
    console.log("Generating PDF report...");

    // Préparer le contenu HTML du rapport
    const htmlContent = `
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }
                h1 { text-align: center; color: #183b71; font-size: 24px; }
                h2 { color: #333; font-size: 20px; border-bottom: 2px solid #ddd; padding-bottom: 5px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f4f4f4; }
                .score { font-weight: bold; }
                .problem { color: red; }
                .ok { color: green; }
                .recommendation { font-style: italic; }
                .footer { margin-top: 40px; font-size: 12px; color: #555; text-align: center; }
            </style>
        </head>
        <body>
            <h1>Website Analysis Report</h1>
            <p><strong>URL Analysée :</strong> ${results.url || '(à modifier)'}</p>
            <p><strong>Date du rapport :</strong> ${new Date().toLocaleString()}</p>

            <h2>Résumé des scores</h2>
            <table>
                <tr><th>Catégorie</th><th>Score</th><th>Statut</th><th>Recommandation</th></tr>
                <tr>
                    <td>Performance</td>
                    <td class="score">${results.performance || '(à modifier)'}</td>
                    <td class="${results.performance > 70 ? "ok" : "problem"}">
                        ${results.performance > 70 ? "Bon" : "À améliorer"}
                    </td>
                    <td class="recommendation">
                        ${results.performance > 70 ? "Aucune action requise" : "Optimisez les scripts et les images."}
                    </td>
                </tr>
                <tr>
                    <td>SEO</td>
                    <td class="score">${results.seo || '(à modifier)'}</td>
                    <td class="${results.seo > 70 ? "ok" : "problem"}">
                        ${results.seo > 70 ? "Bon" : "À améliorer"}
                    </td>
                    <td class="recommendation">
                        ${results.seo > 70 ? "Aucune action requise" : "Ajoutez des balises meta et alt."}
                    </td>
                </tr>
                <tr>
                    <td>Accessibilité</td>
                    <td class="score">${results.accessibility || '(à modifier)'}</td>
                    <td class="${results.accessibility > 70 ? "ok" : "problem"}">
                        ${results.accessibility > 70 ? "Bon" : "À améliorer"}
                    </td>
                    <td class="recommendation">
                        ${results.accessibility > 70 ? "Aucune action requise" : "Ajoutez des labels ARIA."}
                    </td>
                </tr>
                <tr>
                    <td>Headers de Sécurité</td>
                    <td>N/A</td>
                    <td class="${results.missingSecurityHeaders.length === 0 ? "ok" : "problem"}">
                        ${results.missingSecurityHeaders.length === 0 ? "Bon" : "À améliorer"}
                    </td>
                    <td class="recommendation">
                        ${results.missingSecurityHeaders.length === 0 
                            ? "Aucune action requise" 
                            : "Ajoutez : " + results.missingSecurityHeaders.join(', ')}
                    </td>
                </tr>
            </table>

            <h2>Détails des problèmes détectés</h2>
            <ul>
                <li><strong>Liens cassés :</strong> ${results.brokenLinks.length || 'Aucun'}</li>
                <li><strong>Assets lourds :</strong> ${results.largeAssets.largeAssets?.length || 'Aucun'}</li>
                <li><strong>Ressources tierces :</strong> ${results.thirdPartyResources.length || 'Aucune'}</li>
                <li><strong>Impact Carbone (g/visite) :</strong> Grid - ${
                    results.carbonImpact?.statistics?.co2.grid || '(à modifier)'
                }, Renewable - ${
                    results.carbonImpact?.statistics?.co2.renewable || '(à modifier)'
                }</li>
            </ul>

            <h2>Recommandations générales</h2>
            <p>
                Ce rapport met en lumière les points à améliorer pour optimiser votre site. 
                Voici quelques suggestions générales :
            </p>
            <ol>
                <li>Activez la mise en cache côté serveur pour accélérer les performances.</li>
                <li>Ajoutez des headers de sécurité pour protéger vos utilisateurs.</li>
                <li>Optimisez les balises meta pour améliorer le SEO.</li>
                <li>Réduisez la taille des fichiers CSS et JavaScript non utilisés.</li>
            </ol>

            <div class="footer">
                Ce rapport a été généré automatiquement par l'outil d'analyse de site. Pour plus de détails, veuillez contacter [Votre Nom ou Entreprise].
            </div>
        </body>
        </html>
    `;

    // Générer le PDF à partir du contenu HTML
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const pdfPath = `${outputDir}/report.pdf`;
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    await browser.close();

    console.log(`PDF report saved to ${pdfPath}`);
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

        // Assurer que le dossier "out" existe
        const outputDir = './out';
        await fs.mkdir(outputDir, { recursive: true });

        // Capturer les erreurs JavaScript
        logJavaScriptErrors(page);

        // Exécuter toutes les analyses
        const results = {
            url,
            ...await analyzePerformance(url, browserWSEndpoint),
            brokenLinks: await checkBrokenLinks(page),
            cookies: await analyzeCookies(page),
            metadata: await analyzeMetaData(page),
            thirdPartyResources: await analyzeThirdPartyResources(page),
            images: await analyzeImages(page),
            fonts: await analyzeFonts(page),
            missingSecurityHeaders: await analyzeSecurityHeaders(page, url),
            redirects: await analyzeRedirects(page, url),
            largeAssets: await analyzeAssets(page),
            carbonImpact: await analyzeCarbonImpact(url),
        };

        // Logs importants pour vous
        detailedLogs(url, results)
       
        // Sauvegarder le rapport JSON
        const reportPath = './out/complete-analysis.json';
        await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
        console.log(`Analysis complete! Report saved to ${reportPath}`);

        // Générer le PDF
        await generatePDFReport(results, outputDir);

    } catch (error) {
        console.error("Error during analysis:", error);
    } finally {
        await browser.close();
    }
};

// Lancer l'analyse
analyzeSite('https://afs.algerieferries.dz/');


function detailedLogs(url, results) {
     // Logs importants pour vous
     console.log(`\n========= Summary for ${url} =========`);

     console.log(`\nPerformance: ${results.performance || 'N/A'}`);
     console.log(`SEO: ${results.seo || 'N/A'}`);
     console.log(`Accessibility: ${results.accessibility || 'N/A'}`);
     console.log(`Broken Links: ${results.brokenLinks.length || 0}`);
     console.log(`Large Assets: ${results.largeAssets.largeAssets?.length || 0}`);
     console.log(
         `Missing Security Headers: ${
             results.missingSecurityHeaders.length > 0
                 ? results.missingSecurityHeaders.join(', ')
                 : 'None'
         }`
     );
     console.log(`Third-party Resources: ${results.thirdPartyResources.length || 0}`);
     console.log(
         `Carbon Impact (g/visit): Grid - ${
             results.carbonImpact?.statistics?.co2.grid || 'N/A'
         }, Renewable - ${results.carbonImpact?.statistics?.co2.renewable || 'N/A'}`
     );

     console.log(
         results.performance < 70
             ? '\n⚠️ Performance needs improvement!'
             : '\n✅ Performance is good!'
     );

     if (results.brokenLinks.length > 0) {
         console.log('\n⚠️ Broken Links Detected:');
         results.brokenLinks.forEach(link =>
             console.log(`- ${link.url} (status: ${link.status})`)
         );
     } else {
         console.log('\n✅ No broken links detected.');
     }

     if (results.missingSecurityHeaders.length > 0) {
         console.log('\n⚠️ Missing Security Headers:');
         results.missingSecurityHeaders.forEach(header => console.log(`- ${header}`));
     } else {
         console.log('\n✅ All security headers are present.');
     }

     console.log('\n======================================\n');

}