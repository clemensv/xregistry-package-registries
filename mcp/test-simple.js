// Simple test script to call the server
const http = require('http');

function testEndpoint(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3600,
            path: path,
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    console.log(`\n=== ${path} ===`);
                    console.log(JSON.stringify(json, null, 2));
                    resolve(json);
                } catch (e) {
                    console.error(`Failed to parse response for ${path}:`, data);
                    reject(e);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`Error calling ${path}:`, error.message);
            reject(error);
        });

        req.end();
    });
}

async function runTests() {
    console.log('Testing MCP xRegistry endpoints...\n');
    
    try {
        await testEndpoint('/');
    } catch (e) {
        console.error('Root test failed:', e.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
        await testEndpoint('/mcpproviders');
    } catch (e) {
        console.error('Providers test failed:', e.message);
    }
}

runTests();
