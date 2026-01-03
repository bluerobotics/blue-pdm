/**
 * Test: Add a new member via CLI and clean up after
 * Usage: node scripts/test-add-member.js
 * 
 * Requires the app to be running (npm run dev)
 */

const http = require('http');

const CLI_PORT = 31337;
const CLI_HOST = '127.0.0.1';

// Send a command to the BluePLM CLI server
function sendCommand(command) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ command });
    
    const req = http.request({
      hostname: CLI_HOST,
      port: CLI_PORT,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve(result);
        } catch (e) {
          reject(new Error(`Invalid response: ${body}`));
        }
      });
    });
    
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('BluePLM is not running. Start with: npm run dev'));
      } else {
        reject(err);
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Command timed out'));
    });
    
    req.write(data);
    req.end();
  });
}

// Execute command and print results
async function exec(command) {
  console.log(`> ${command}`);
  try {
    const result = await sendCommand(command);
    
    if (result.success && result.result?.outputs) {
      for (const output of result.result.outputs) {
        const prefix = output.type === 'error' ? '✗' : output.type === 'success' ? '✓' : ' ';
        console.log(`${prefix} ${output.content}`);
      }
      return result.result.outputs;
    } else if (result.error) {
      console.log(`✗ Error: ${result.error}`);
      return null;
    }
    return result.result?.outputs || [];
  } catch (err) {
    console.log(`✗ ${err.message}`);
    return null;
  }
}

// Check if output contains text
function outputContains(outputs, text) {
  if (!outputs) return false;
  return outputs.some(o => o.content.toLowerCase().includes(text.toLowerCase()));
}

async function main() {
  console.log('============================================');
  console.log('  BluePLM CLI Member Management Test');
  console.log('============================================\n');

  const testEmail = 'test.cli.user@example.com';
  const testName = 'Test CLI User';
  const testTeam = 'Manufacturing';

  try {
    // Step 1: Check current state
    console.log('--- Step 1: Check current members ---');
    await exec('members');
    console.log('');

    // Step 2: List teams
    console.log('--- Step 2: List teams ---');
    await exec('teams');
    console.log('');

    // Step 3: Create test invite
    console.log('--- Step 3: Create test invite ---');
    const inviteResult = await exec(`invite ${testEmail} --name="${testName}" --team=${testTeam}`);
    const inviteSuccess = outputContains(inviteResult, 'Invited') || outputContains(inviteResult, 'success');
    console.log(`Invite created: ${inviteSuccess ? 'YES' : 'NO'}`);
    console.log('');

    // Step 4: Verify pending invite
    console.log('--- Step 4: Verify pending invite ---');
    const pendingResult = await exec('pending');
    const hasPending = outputContains(pendingResult, testEmail);
    console.log(`Found in pending: ${hasPending ? 'YES' : 'NO'}`);
    console.log('');

    // Step 5: List workflow roles
    console.log('--- Step 5: List workflow roles ---');
    await exec('roles');
    console.log('');

    // Step 6: List job titles
    console.log('--- Step 6: List job titles ---');
    await exec('titles');
    console.log('');

    // Step 7: Clean up - remove the test invite
    console.log('--- Step 7: Clean up test invite ---');
    const removeResult = await exec(`remove-member ${testEmail}`);
    const removeSuccess = outputContains(removeResult, 'Removed') || outputContains(removeResult, 'success');
    console.log(`Removed: ${removeSuccess ? 'YES' : 'NO'}`);
    console.log('');

    // Step 8: Verify cleanup
    console.log('--- Step 8: Verify cleanup ---');
    const verifyResult = await exec('pending');
    const stillExists = outputContains(verifyResult, testEmail);
    console.log(`Still in pending: ${stillExists ? 'YES (cleanup failed)' : 'NO (cleaned up)'}`);
    console.log('');

    // Summary
    console.log('============================================');
    console.log('  TEST SUMMARY');
    console.log('============================================');
    console.log(`User: ${testName} <${testEmail}>`);
    console.log(`Team: ${testTeam}`);
    console.log(`Created: ${inviteSuccess ? '✓' : '✗'}`);
    console.log(`Verified: ${hasPending ? '✓' : '✗'}`);
    console.log(`Cleaned: ${!stillExists ? '✓' : '✗'}`);
    console.log(`Result: ${inviteSuccess && hasPending && !stillExists ? 'PASSED ✓' : 'FAILED ✗'}`);

  } catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
  }
}

main();
