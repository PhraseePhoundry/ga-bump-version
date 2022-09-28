// test
const { execSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const { EOL, version } = require('os');
const path = require('path');
const semver = require('semver');

const MAJOR_VERSION_WORDING = ['MAJOR VERSION INCREMENT', 'major', 'breaking change'];
const MINOR_VERSION_WORDING = ['MINOR VERSION INCREMENT', 'new feature', 'minor'];
const SET_CUSTOM_VERSION_WORDING = ['SET VERSION NUMBER'];
const VERSION_BUMP_COMMIT_MESSAGE_TEXT = 'ci: version bump to {{version}}';
const TAG_PREFIX = 'v'

// Change working directory if user defined PACKAGEJSON_DIR
if (process.env.PACKAGEJSON_DIR) {
  process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PACKAGEJSON_DIR}`;
  process.chdir(process.env.GITHUB_WORKSPACE);
}

const workspace = process.env.GITHUB_WORKSPACE;
const pkg = getPackageJson();

(async () => {
  const event = process.env.GITHUB_EVENT_PATH ? require(process.env.GITHUB_EVENT_PATH) : {};

  if (!event.commits) {
    console.log("Couldn't find any commits in this event, incrementing patch version...");
  }

  console.log('tagPrefix:', TAG_PREFIX);
  const messages = event.commits ? event.commits.map((commit) => commit.message + '\n' + commit.body) : [];

  const commitMessage = VERSION_BUMP_COMMIT_MESSAGE_TEXT;
  console.log('commit messages:', messages);

  const commitMessageRegex = new RegExp(commitMessage.replace(/{{version}}/g, `${TAG_PREFIX}\\d+\\.\\d+\\.\\d+`), 'ig');

  const isVersionBump = messages.find((message) => commitMessageRegex.test(message)) !== undefined;
  if (isVersionBump) {
    exitSuccess('No action necessary because we found a previous bump!');
    return;
  }

  console.log('config words:', { SET_CUSTOM_VERSION_WORDING, MAJOR_VERSION_WORDING, MINOR_VERSION_WORDING });

  let version;

  // case: if wording for SET CUSTOM VERSION found
  if (messages.some((message) => SET_CUSTOM_VERSION_WORDING.some((word) => message.includes(word)))) {
    version = 'custom';
  }
  // case: if wording for MAJOR found
  else if (messages.some((message) => MAJOR_VERSION_WORDING.some((word) => message.includes(word)))) {
    version = 'major';
  }
  // case: if wording for MINOR found
  else if (messages.some((message) => MINOR_VERSION_WORDING.some((word) => message.includes(word)))) {
    version = 'minor';
  }
  // case: if wording for PATCH found
  else {
    version = 'patch';
  }

  console.log('version action:', version);

  let versionNumbers = [];
  if (version === 'custom') {
    messages.forEach((message) => {
      const matches = message.match(/SET VERSION NUMBER {v?[0-9]+[.][0-9]+[.][0-9]+}/g);
      const versionNumberRegex = new RegExp(/v?[0-9]+[.][0-9]+[.][0-9]+/g);
      if (matches) {
        for (let match of matches) {
          const number = match.match(versionNumberRegex);
          versionNumbers.push(number[0]);
        }
      }
    });
    if (versionNumbers.length === 0) {
      exitFailure('No custom version numbers found');
      return;
    }
  }

  // GIT logic
  try {
    const current = pkg.version.toString();
    // set git user
    await runInWorkspace('git', ['config', 'user.name', `"${process.env.GITHUB_USER || 'Automated Version Bump'}"`]);
    await runInWorkspace('git', [
      'config',
      'user.email',
      `"${process.env.GITHUB_EMAIL || 'ga-bump-version@users.noreply.github.com'}"`
    ]);

    console.log('****************')
    console.log(process.env.GITHUB_USER)
    console.log(process.env.GITHUB_EMAIL)


    let currentBranch;
    let isPullRequest = false;
    if (process.env.GITHUB_HEAD_REF) {
      // Comes from a pull request
      currentBranch = process.env.GITHUB_HEAD_REF;
      console.log('~~~~ pull request true ~~~~')
      isPullRequest = true;
    } else {
      currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1];
    }
    console.log('currentBranch:', currentBranch);

    if (!currentBranch) {
      exitFailure('No branch found');
      return;
    }

    // do it in the current checked out github branch (DETACHED HEAD)
    // important for further usage of the package.json version
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', current]);
    console.log('current 1:', current, '/', 'version:', version);

    let newVersion;
    let newSemVersion;
    if (version === 'custom') {
      newSemVersion = getHighestVersionNumber(versionNumbers)
      if(!semver.gt(newSemVersion, current)) {
        throw new Error('New custom version must be higher than current version')
      }
      newVersion = execSync(`npm version --git-tag-version=false ${newSemVersion}`).toString().trim().replace(/^v/, '');
    } else {
      newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '');
    }
    console.log('newVersion 1:', newVersion);
    newVersion = `${TAG_PREFIX}${newVersion}`;
    console.log(newVersion);
    await runInWorkspace('git', ['status']);
    await runInWorkspace('git', ['commit', '-a', '-m', commitMessage.replace(/{{version}}/g, newVersion)]);

    // now go to the actual branch to perform the same versioning
    if (isPullRequest) {
      // First fetch to get updated local version of branch
      await runInWorkspace('git', ['fetch']);
    }
    await runInWorkspace('git', ['checkout', currentBranch]);
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', current]);
    console.log('current 2:', current, '/', 'version:', version);
    console.log('execute npm version now with the new version:', version);
    if (version === 'custom') {
      newVersion = execSync(`npm version --git-tag-version=false ${newSemVersion}`).toString().trim().replace(/^v/, '');
    } else {
      newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '');
    }
    newVersion = newVersion.split(/\n/)[1] || newVersion;
    console.log('newVersion 2:', newVersion);
    newVersion = `${TAG_PREFIX}${newVersion}`;
    console.log(`newVersion after merging tagPrefix+newVersion: ${newVersion}`);
    console.log(`::set-output name=newTag::${newVersion}`);
    console.log('--------')
    console.log(process.env.GITHUB_ACTOR)

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
    await runInWorkspace('git', ['tag', newVersion]);
    await runInWorkspace('git', ['push', remoteRepo, '--follow-tags']);
    await runInWorkspace('git', ['push', remoteRepo, '--tags']);
  } catch (e) {
    logError(e);
    exitFailure('Failed to bump version');
    return;
  }
  exitSuccess('Version bumped!');
})();

function getPackageJson() {
  const pathToPackage = path.join(workspace, 'package.json');
  if (!existsSync(pathToPackage)) throw new Error("package.json could not be found in your project's root.");
  return require(pathToPackage);
}

function exitSuccess(message) {
  console.info(`✔  success   ${message}`);
  process.exit(0);
}

function exitFailure(message) {
  logError(message);
  process.exit(1);
}

function logError(error) {
  console.error(`✖  fatal     ${error.stack || error}`);
}

function runInWorkspace(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace });
    let isDone = false;
    const errorMessages = [];
    child.on('error', (error) => {
      if (!isDone) {
        isDone = true;
        reject(error);
      }
    });
    child.stderr.on('data', (chunk) => errorMessages.push(chunk));
    child.on('exit', (code) => {
      if (!isDone) {
        if (code === 0) {
          resolve();
        } else {
          reject(`${errorMessages.join('')}${EOL}${command} exited with code ${code}`);
        }
      }
    });
  });
}

// function for getting the highest version number, if multiple custom versions are found
function getHighestVersionNumber(versions) {
  const versionNumbers = versions.map(version => semver.clean(version))

  return versionNumbers.sort(semver.rcompare)[0]
}
