import * as googleapis from 'googleapis'
import * as vscode from 'vscode';
import {Credentials} from 'google-auth-library/build/src/auth/credentials';
import * as os from 'os'
import * as fs from 'fs'
import * as child_process from 'child_process'

let gFilename = '';
let gAuthCode: string|undefined;
let gAuthCredentials: Credentials|undefined;

// Fetches the list of installed extension IDs.
function getInstalledExtensionIds(): string[] {
  let installed = new Array<string>();
  for (let extension of vscode.extensions.all) {
    if (extension.packageJSON.isBuiltin)
      continue;
    installed.push(extension.id);
  }
  return installed;
}

class Config {
  public settings = new Array<string>();
  public keybindings = new Array<string>();
  public locale = new Array<string>();
  public extensions = new Array<string>();
}

// Opens up a browser so the user can get a Google Drive auth token.
async function getAuthCodeFromUser(): Promise<string|undefined> {
  const url = getOauth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
  });

  await vscode.window.showInputBox({
    value: url,
    prompt:
        'Please open this URL in your browser, complete the flow, and paste the token in the next input box.'
  });

  return await vscode.window.showInputBox(
      {prompt: 'Enter token from web browser', ignoreFocusOut: true});
}

// Checks to see if an auth token is available. Asks the user for one if there
// is none.
async function checkToken(): Promise<boolean> {
  if (gAuthCode && gAuthCredentials && gFilename)
    return true;

  const kFilenamePref = 'sync.filename';
  const kCodePref = 'sync.code';
  const kCredentialsPref = 'sync.credentials';

  let config = vscode.workspace.getConfiguration();

  gFilename = config.get<string>(kFilenamePref, '');
  if (!gFilename) {
    vscode.window.showErrorMessage(`${kFilenamePref} cannot be empty`);
    return false;
  }

  gAuthCode = config.get(kCodePref);
  if (!gAuthCode) {
    gAuthCode = await getAuthCodeFromUser();
    if (gAuthCode)
      config.update(kCodePref, gAuthCode, vscode.ConfigurationTarget.Global);
  }
  if (!gAuthCode)
    return false;

  let configValue = config.get<string>(kCredentialsPref);
  if (configValue)
    gAuthCredentials = JSON.parse(configValue);
  if (!gAuthCredentials || !gAuthCredentials.access_token) {
    let auth = getOauth2Client();
    let token = await auth.getToken(gAuthCode);
    if (token.res && token.res.status == 200) {
      config.update(
          kCredentialsPref, JSON.stringify(token.tokens),
          vscode.ConfigurationTarget.Global);
      gAuthCredentials = token.tokens;
    }
  }

  return !!gAuthCredentials;
}

async function findFileInGDrive(
    drive: googleapis.drive_v3.Drive,
    warn: boolean): Promise<string|undefined> {
  let file = await drive.files.list({q: `name = '${gFilename}'`});
  if (!file.data.files || file.data.files.length == 0) {
    if (warn)
      vscode.window.showInformationMessage(`Sync: Unable to find ${gFilename}`);
    return;
  }
  if (file.data.files.length > 1) {
    if (warn) {
      vscode.window.showErrorMessage(`Sync: There is more than one matching ${
          gFilename} file. Please delete some of them.`)
    }
    return;
  }
  return file.data.files[0].id;
}

async function uploadConfigToGDrive(config: Config) {
  if (!await checkToken())
    return;

  let body = JSON.stringify(config, null, 2);

  let drive = googleapis.google.drive({version: 'v3', auth: getOauth2Client()});
  let id = await findFileInGDrive(drive, /*warn*/ false);
  if (!id) {
    await drive.files.create({
      requestBody: {name: gFilename, mimeType: 'text/plain'},
      media: {mediaType: 'application/json', body: body}
    });
    return;
  }

  await drive.files.update(
      {fileId: id, media: {mediaType: 'application/json', body: body}});
}

// Downloads the config from google drive.
async function downloadConfigFromGDrive(): Promise<Config> {
  if (!await checkToken())
    throw new Error('No token');

  let drive = googleapis.google.drive({version: 'v3', auth: getOauth2Client()});
  let id = await findFileInGDrive(drive, /*warn*/ true);
  if (!id)
    throw new Error('Cannot find file');

  let content =
      await drive.files.get(<googleapis.drive_v3.Params$Resource$Files$Get>{
        fileId: id,
        alt: 'media'
      });
  let data = <any>content.data;

  let config = new Config();
  for (let key in config) {
    if (data[key])
      (<any>config)[key] = data[key];
  }
  return config;
}

// Builds an oauth2 client. If credentials are available the client is
// authenticated.
function getOauth2Client() {
  let auth = new googleapis.google.auth.OAuth2(
      '110900474720-ca2o8jidt9fbmup9c50t51bjrl5omdk4.apps.googleusercontent.com',  // client_id
      'UFH1TiCGBNp9ZCykoSdvRPF5',   // client_secret
      'urn:ietf:wg:oauth:2.0:oob',  // redirect uri
  );
  if (gAuthCredentials)
    auth.setCredentials(gAuthCredentials);
  return auth;
}


function getOsName() {
  switch (os.platform()) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
  }
  throw new Error('Unknown platform ' + os.platform());
}

function getHostname() {
  return os.hostname();
}

function getEnv(name: string) {
  return process.env[name];
}

function getConfigPath(filename: string) {
  let home = getEnv('HOME');
  let appData = getEnv('APPDATA');

  switch (os.platform()) {
    case 'darwin':
      return `${home}/Library/Application Support/Code/User/${filename}`;
    case 'linux':
      return `${home}/.config/Code/User/${filename}`;
    case 'win32':
      return `${appData}/Code/User/${filename}`
  }
  throw new Error('Unknown platform ' + os.platform());
}

async function runCodeBinary(args: string[]) {
  let bin = 'code;'
  if (os.platform() == 'win32')
  bin = 'code.cmd'

  return new Promise(done => {
    let child = child_process.spawn(bin, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data;
    });
    child.stderr.on('data', data => {
      stderr += data;
    });
    child.on('close', () => {
      console.log(`Output of ${bin} ${args.join(' ')}`);
      if (stdout)
        console.log(`==stdout==\n${stdout}`);
      if (stderr)
        console.log(`==stderr==\n${stderr}`);
      done();
    });
  });
}

async function downloadCommand() {
  try {
    function write(name: string, contentLines: string[]) {
      let path = getConfigPath(name);
      let content = contentLines.join('\n');
      let local = uncommentForLocalSave(content);
      fs.writeFileSync(path, local);
    }

    let config = await downloadConfigFromGDrive();

    // Update settings files.
    write('settings.json', config.settings);
    write('keybindings.json', config.keybindings);
    write('locale.json', config.locale);

    // Add/remove extensions.
    let installed = getInstalledExtensionIds();
    let expected = config.extensions;
    let toInstall = expected.filter(x => installed.indexOf(x) < 0);
    let toRemove = installed.filter(x => expected.indexOf(x) < 0);
    for (let id of toInstall)
      await runCodeBinary(['--install-extension', id]);
    for (let id of toRemove)
      await runCodeBinary(['--uninstall-extension', id]);

    vscode.window.showInformationMessage('Sync download success');
    if (toInstall.length > 0 || toRemove.length > 0) {
      let msg = 'Please reload the window.';
      if (toInstall.length > 0)
        msg += ` Installed extensions: ${toInstall.join(' ')}`;
      if (toRemove.length > 0)
        msg += ` Removed extensions: ${toRemove.join(' ')}`;
      const kReload = 'Reload';
      let action = await vscode.window.showInformationMessage(msg, kReload);
      if (action == kReload)
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Sync download failed: ${e}`);
  }
}

async function uploadCommand() {
  try {
    function read(name: string): string[] {
      let path = getConfigPath(name);
      let raw = fs.readFileSync(path).toString();
      return commentForUpload(raw);
    }

    let config = new Config();
    config.settings = read('settings.json');
    config.keybindings = read('keybindings.json');
    config.locale = read('locale.json');
    config.extensions = getInstalledExtensionIds();
    await uploadConfigToGDrive(config);

    vscode.window.showInformationMessage('Sync upload success');
  } catch (e) {
    vscode.window.showErrorMessage(`Sync upload failed: ${e}`);
  }
}

function commentForUpload(fileContent: string): string[] {
  function err(msg: string) {
    vscode.window.showErrorMessage(msg);
  }

  let result = [];
  let inSync = false;
  for (let line of fileContent.split(/\r?\n/)) {
    let beginSync = line.includes('@beginSync');
    let endSync = line.includes('@endSync');

    if (beginSync && endSync)
      err('@beginSync and @endSync cannot be be on same line');
    if (beginSync && inSync)
      err('@beginSync nesting is not supported');

    if (inSync && line.trim().startsWith('//') == false) {
      let offset = line.length - line.trim().length;
      result.push(line.substring(0, offset) + '//' + line.substring(offset));
      continue;
    }

    if (beginSync)
      inSync = true;
    if (endSync)
      inSync = false;

    result.push(line);
  }
  return result;
}

function uncommentForLocalSave(fileContent: string): string {
  function err(msg: string) {
    vscode.window.showErrorMessage(msg);
  }

  let result = [];
  let inSync = false;
  let applyBlock = false;
  for (let line of fileContent.split(/\r?\n/)) {
    if (!line.trim().startsWith('//')) {
      result.push(line);
      continue;
    }

    let beginSync = line.includes('@beginSync');
    let endSync = line.includes('@endSync');
    if (!beginSync && !endSync && !inSync) {
      result.push(line);
      continue;
    }

    if (beginSync && endSync)
      err('@beginSync and @endSync cannot be be on same line');
    if (beginSync && inSync)
      err('@beginSync nesting is not supported');

    if (beginSync)
      inSync = true;
    if (endSync) {
      inSync = false;
      applyBlock = false;
      result.push(line);
      continue;
    }

    if (!beginSync) {
      if (applyBlock) {
        result.push(line.replace('//', ''));
      } else {
        result.push(line);
      }
      continue;
    }

    // Determine if we want to apply this block.
    result.push(line);

    function extractToken(identifier: string): string|undefined {
      let index = line.indexOf(identifier);
      if (index < 0)
        return;

      let start = index + identifier.length;
      let result = '';
      while (start < line.length && line.charAt(start) != ' ') {
        result += line.charAt(start);
        start++;
      }
      if (result == '')
        return undefined;
      return result;
    }

    applyBlock = true;

    // Verify hostname matches.
    let hostname = extractToken('hostname:');
    if (hostname && getHostname() != hostname)
      applyBlock = false;

    // Verify os matches.
    let os = extractToken('os:');
    if (os && getOsName() != os)
      applyBlock = false;
  }

  return result.join('\n');
}

export async function activate(context: vscode.ExtensionContext) {
  // Some simple tests comment/uncomment functions. It'd be good to add actual
  // tests.

  /*
  console.log(commentForUpload(`
  // @beginSync foobar
  one
  two
SOL
  // @endSync

  // @beginSync
  // something
  // @endSync
  `));
  */

  /*
  console.log(uncommentForLocalSave(`
  one
  // @beginSync hostname:bad
  // bad
  // @endSync

  // @beginSync hostname:DESKTOP-FS50R2V
  // good
  // one
  // @endSync

  // @beginSync os:windows
  // myconfig
  // yea!!
     // foobar //lk
  // @endSync
  `));
*/

  context.subscriptions.push(
      vscode.commands.registerCommand('sync.download', downloadCommand));
  context.subscriptions.push(
      vscode.commands.registerCommand('sync.upload', uploadCommand));
}