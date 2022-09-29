// test
const { execSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const { EOL, version } = require('os');
const path = require('path');
const semver = require('semver');
const core = require('@actions/core');

const MAJOR_VERSION_WORDING = ['MAJOR VERSION INCREMENT', 'major', 'breaking change'];
const MINOR_VERSION_WORDING = ['MINOR VERSION INCREMENT', 'new feature', 'minor'];
const SET_CUSTOM_VERSION_WORDING = ['SET VERSION NUMBER'];
const TAG_PREFIX = 'v'

const latestVersion = core.getInput('tag');

const workspace = process.env.GITHUB_WORKSPACE;

(async () => {
  const event = process.env.GITHUB_EVENT_PATH ? require(process.env.GITHUB_EVENT_PATH) : {};

  if (!event.commits) {
    console.log("Couldn't find any commits in this event, incrementing patch version...");
  }

  console.log('tagPrefix:', TAG_PREFIX);
  const messages = event.commits ? event.commits.map((commit) => commit.message + '\n' + commit.body) : [];

  console.log('commit messages:', messages);

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
    // set git user
    await runInWorkspace('git', ['config', 'user.name', `"${process.env.GITHUB_USER || 'Automated Version Bump'}"`]);
    await runInWorkspace('git', [
      'config',
      'user.email',
      `"${process.env.GITHUB_EMAIL || 'ga-bump-version@users.noreply.github.com'}"`
    ]);

    const currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1];
    console.log('currentBranch:', currentBranch);

    if (!currentBranch) {
      exitFailure('No branch found');
      return;
    }

    // do it in the current checked out github branch (DETACHED HEAD)
    // important for further usage of the package.json version
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', latestVersion]);
    console.log('current 1:', latestVersion, '/', 'version:', version);

    let newVersion;
    let newSemVersion;
    if (version === 'custom') {
      newSemVersion = getHighestVersionNumber(versionNumbers)
      if(!semver.gt(newSemVersion, latestVersion)) {
        throw new Error('New custom version must be higher than current version')
      }
      newVersion = execSync(`npm version --git-tag-version=false ${newSemVersion}`).toString().trim().replace(/^v/, '');
    } else {
      newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '');
    }
    console.log('newVersion 1:', newVersion);
    newVersion = `${TAG_PREFIX}${newVersion}`;
    console.log(newVersion);

    // now go to the actual branch to perform the same versioning
    await runInWorkspace('git', ['checkout', currentBranch]);
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', latestVersion]);
    console.log('current 2:', latestVersion, '/', 'version:', version);
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

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
    await runInWorkspace('git', ['tag', newVersion]);
    await runInWorkspace('git', ['push', remoteRepo, '--tags']);
  } catch (e) {
    logError(e);
    exitFailure('Failed to bump version');
    return;
  }
  exitSuccess('Version bumped!');
})();

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
