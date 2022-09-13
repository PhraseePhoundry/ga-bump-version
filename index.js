// test
const { execSync, spawn } = require('child_process');
const { existsSync } = require('fs');
const { EOL } = require('os');
const path = require('path');

// Change working directory if user defined PACKAGEJSON_DIR
if (process.env.PACKAGEJSON_DIR) {
  process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PACKAGEJSON_DIR}`;
  process.chdir(process.env.GITHUB_WORKSPACE);
}

const workspace = process.env.GITHUB_WORKSPACE;
const pkg = getPackageJson();

(async () => {
  const event = process.env.GITHUB_EVENT_PATH ? require(process.env.GITHUB_EVENT_PATH) : {};

  if (!event.commits && !process.env['INPUT_VERSION-TYPE']) {
    console.log("Couldn't find any commits in this event, incrementing patch version...");
  }

  const allowedTypes = ['major', 'minor', 'patch', 'rc']
  if (process.env['INPUT_VERSION-TYPE'] && !allowedTypes.includes(process.env['INPUT_VERSION-TYPE'])) {
    exitFailure('Invalid version type');
    return;
  }

  const versionType = process.env['INPUT_VERSION-TYPE'];
  const tagPrefix = process.env['INPUT_TAG-PREFIX'] || '';
  console.log('tagPrefix:', tagPrefix);
  const messages = event.commits ? event.commits.map((commit) => commit.message + '\n' + commit.body) : [];

  const commitMessage = process.env['INPUT_COMMIT-MESSAGE'] || 'ci: version bump to {{version}}';
  console.log('commit messages:', messages);

  const bumpPolicy = process.env['INPUT_BUMP-POLICY'] || 'all';
  const commitMessageRegex = new RegExp(commitMessage.replace(/{{version}}/g, `${tagPrefix}\\d+\\.\\d+\\.\\d+`), 'ig');

  let isVersionBump = false;

  if (bumpPolicy === 'all') {
    isVersionBump = messages.find((message) => commitMessageRegex.test(message)) !== undefined;
  } else if (bumpPolicy === 'last-commit') {
    isVersionBump = messages.length > 0 && commitMessageRegex.test(messages[messages.length - 1]);
  } else if (bumpPolicy === 'ignore') {
    console.log('Ignoring any version bumps in commits...');
  } else {
    console.warn(`Unknown bump policy: ${bumpPolicy}`);
  }

  if (isVersionBump) {
    exitSuccess('No action necessary because we found a previous bump!');
    return;
  }

  // input wordings for MAJOR, MINOR, PATCH, PRE-RELEASE
  const setCustomVersionWords = process.env['INPUT_SET-CUSTOM-VERSION-WORDING'].split(',');
  const majorWords = process.env['INPUT_MAJOR-WORDING'].split(',');
  const minorWords = process.env['INPUT_MINOR-WORDING'].split(',');
  // patch is by default empty, and '' would always be true in the includes(''), thats why we handle it separately
  const patchWords = process.env['INPUT_PATCH-WORDING'] ? process.env['INPUT_PATCH-WORDING'].split(',') : null;

  console.log('config words:', { setCustomVersionWords, majorWords, minorWords, patchWords });

  let version;

  // case if version-type found
  if (versionType) {
    version = versionType;
  }
  // case: if wording for SET CUSTOM VERSION found
  else if (messages.some((message) => setCustomVersionWords.some((word) => message.includes(word)))) {
    version = 'custom';
  }
  // case: if wording for MAJOR found
  else if (messages.some((message) => majorWords.some((word) => message.includes(word)))) {
    version = 'major';
  }
  // case: if wording for MINOR found
  else if (messages.some((message) => minorWords.some((word) => message.includes(word)))) {
    version = 'minor';
  }
  // case: if wording for PATCH found
  else if (patchWords && messages.some((message) => patchWords.some((word) => message.includes(word)))) {
    version = 'patch';
  }

  console.log('version action:', version);

  // case: if nothing of the above matches
  if (!version) {
    exitSuccess('No version keywords found, skipping bump.');
    return;
  }

  let versionNumbers = []
  if (version === 'custom') {
    messages.forEach(message => {
      const matches = message.match(/SET VERSION NUMBER {v?[0-9]+[.][0-9]+[.][0-9]+}/g)
      console.log('--- message ---')
      console.log(message)
      console.log('--- matches ---')
      console.log(matches)
      const versionNumberRegex = new RegExp(/v?[0-9]+[.][0-9]+[.][0-9]+/g);
      if(matches) {
        for(let match of matches) {
          const number = match.match(versionNumberRegex)
          versionNumbers.push(number[0])
        }
      }
    })
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
      `"${process.env.GITHUB_EMAIL || 'gh-action-bump-version@users.noreply.github.com'}"`,
    ]);

    let currentBranch;
    let isPullRequest = false;
    if (process.env.GITHUB_HEAD_REF) {
      // Comes from a pull request
      currentBranch = process.env.GITHUB_HEAD_REF;
      isPullRequest = true;
    } else {
      currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1];
    }
    if (process.env['INPUT_TARGET-BRANCH']) {
      // We want to override the branch that we are pulling / pushing to
      currentBranch = process.env['INPUT_TARGET-BRANCH'];
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
    if(version === 'custom') {
      console.log('---- custom new version ----')
      newVersion = versionNumbers[0].replace(/^v/, '');
      console.log(newVersion)
    } else {
      newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '');
    }
    console.log('newVersion 1:', newVersion);
    newVersion = `${tagPrefix}${newVersion}`;
    console.log(newVersion)
    if (process.env['INPUT_SKIP-COMMIT'] !== 'true') {
      console.log('--- skip commit not true ---')
      console.log(commitMessage)
      console.log(newVersion)
      console.log(commitMessage.replace(/{{version}}/g, newVersion))
      await runInWorkspace('git', ['commit', '-a', '-m', commitMessage.replace(/{{version}}/g, newVersion)]);
      console.log('--- run in workspace completed ---')
    }

    // now go to the actual branch to perform the same versioning
    if (isPullRequest) {
      // First fetch to get updated local version of branch
      await runInWorkspace('git', ['fetch']);
    }
    await runInWorkspace('git', ['checkout', currentBranch]);
    await runInWorkspace('npm', ['version', '--allow-same-version=true', '--git-tag-version=false', current]);
    console.log('current 2:', current, '/', 'version:', version);
    console.log('execute npm version now with the new version:', version);
    newVersion = execSync(`npm version --git-tag-version=false ${version}`).toString().trim().replace(/^v/, '');
    // fix #166 - npm workspaces
    // https://github.com/phips28/gh-action-bump-version/issues/166#issuecomment-1142640018
    newVersion = newVersion.split(/\n/)[1] || newVersion;
    console.log('newVersion 2:', newVersion);
    newVersion = `${tagPrefix}${newVersion}`;
    console.log(`newVersion after merging tagPrefix+newVersion: ${newVersion}`);
    console.log(`::set-output name=newTag::${newVersion}`);
    try {
      // to support "actions/checkout@v1"
      if (process.env['INPUT_SKIP-COMMIT'] !== 'true') {
        await runInWorkspace('git', ['commit', '-a', '-m', commitMessage.replace(/{{version}}/g, newVersion)]);
      }
    } catch (e) {
      console.warn(
        'git commit failed because you are using "actions/checkout@v2"; ' +
          'but that doesnt matter because you dont need that git commit, that\'s only for "actions/checkout@v1"',
      );
    }

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
    if (process.env['INPUT_SKIP-TAG'] !== 'true') {
      await runInWorkspace('git', ['tag', newVersion]);
      if (process.env['INPUT_SKIP-PUSH'] !== 'true') {
        await runInWorkspace('git', ['push', remoteRepo, '--follow-tags']);
        await runInWorkspace('git', ['push', remoteRepo, '--tags']);
      }
    } else {
      if (process.env['INPUT_SKIP-PUSH'] !== 'true') {
        await runInWorkspace('git', ['push', remoteRepo]);
      }
    }
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
  console.log('--- run in workspace ---')
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workspace });
    let isDone = false;
    const errorMessages = [];
    child.on('error', (error) => {
      console.log('--- error ---')
      console.log(error)
      if (!isDone) {
        isDone = true;
        reject(error);
      }
    });
    child.stderr.on('data', (chunk) => errorMessages.push(chunk));
    console.log('--- error messages ---')
    console.log(errorMessages)
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
  //return execa(command, args, { cwd: workspace });
}
