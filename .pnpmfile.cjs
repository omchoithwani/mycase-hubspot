// Allow lifecycle scripts for these packages
function readPackage(pkg) {
  return pkg;
}

module.exports = { hooks: { readPackage } };
