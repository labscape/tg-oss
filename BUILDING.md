export OVEVERSION="0.7.27.t1"
npx nx run ove:build --mode=umd --skip-nx-cache && mv packages/ove/dist/ove/index.umd.js dist/ove-${OVEVERSION}.js && mv packages/ove/dist/ove/ove.css dist/ove-${OVEVERSION}.css && rm -rf packages/ove/dist/
