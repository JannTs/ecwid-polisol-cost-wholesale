/* eslint-env node */
module.exports = {
      root: true,
      ignorePatterns: [
            'node_modules',
            '.nuxt',
            '.output',
            '.nitro',
            '.cache',
            'dist',
            'dev',
            'nuxt'
      ],
      parser: 'vue-eslint-parser',
      parserOptions: {
            parser: '@typescript-eslint/parser',
            ecmaVersion: 2022,
            sourceType: 'module',
            extraFileExtensions: ['.vue']
      },
      extends: [
            'eslint:recommended',
            'plugin:@typescript-eslint/recommended',
            'plugin:vue/vue3-recommended',
            'plugin:prettier/recommended' // включает eslint-config-prettier и запускает prettier как правило
      ],
      rules: {
            'vue/multi-word-component-names': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
      }
};
