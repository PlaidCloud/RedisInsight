import {
  expect,
  describe,
  it,
  deps,
  validateApiCall,
  AdmZip,
  fsExtra,
  path,
  serverConfig, requirements,
  before,
  _,
} from '../deps';
import { getBaseURL } from '../../helpers/server';
const { server, request, localDb } = deps;

// create endpoint
const creatEndpoint = () => request(server).post(`/custom-tutorials`);
const manifestEndpoint = () => request(server).get(`/custom-tutorials/manifest`);
const deleteEndpoint = (id: string) => () => request(server).delete(`/custom-tutorials/${id}`);

const customTutorialsFolder = serverConfig.get('dir_path').customTutorials;
const staticsFolder = serverConfig.get('dir_path').staticDir;


const getZipArchive = () => {
  const zipArchive = new AdmZip();

  zipArchive.addFile('info.md', Buffer.from('# info.md', 'utf8'));
  zipArchive.addFile('info.json', Buffer.from('# info.json', 'utf8'));
  zipArchive.addFile('info.tar', Buffer.from('# info.tar', 'utf8'));
  zipArchive.addFile('_info.tar', Buffer.from('# info.tar', 'utf8'));
  zipArchive.addFile('folder/file.md', Buffer.from('# folder/file.md', 'utf8'));
  zipArchive.addFile('.folder/file.md', Buffer.from('# .folder/file.md', 'utf8'));
  zipArchive.addFile('.folder/file2.md', Buffer.from('# .folder/file2.md', 'utf8'));
  zipArchive.addFile('_folder/file.md', Buffer.from('# _folder/file.md', 'utf8'));
  zipArchive.addFile('__MACOSX/file.md', Buffer.from('# __MACOSX/file.md', 'utf8'));

  return zipArchive;
}

const checkFilesUnarchivedFiles = (zip: AdmZip, tutorialFolder = '/') => {
  zip.getEntries().forEach((entry) => {
    expect(fsExtra.existsSync(path.join(
      customTutorialsFolder,
      tutorialFolder,
      entry.entryName,
    ))).eq(!entry.entryName.startsWith('__MACOSX'));
  });
}

const autoGeneratedManifest = {
  children: [
    {
      id: 'folder',
      type: 'group',
      label: 'folder',
      children: [
        {
          id: 'file.md',
          type: 'internal-link',
          label: 'file',
          args: { path: '/folder/file.md' }
        }
      ]
    },
    {
      id: 'info.md',
      type: 'internal-link',
      label: 'info',
      args: { path: '/info.md' }
    }
  ],
};

const testManifest = {
  id: 'id',
  type: 'group',
  label: 'my tutorial',
  children: [
    {
      id: 'main-page',
      type: 'internal-link',
      label: 'INFO',
      args: { path: '/info.md' }
    },
    {
      id: 'some-file',
      type: 'internal-link',
      label: 'FILE',
      args: { path: '/folder/file.md' }
    }
  ],
};

const globalManifest = {
  id: 'custom-tutorials',
  label: 'MY TUTORIALS',
  type: 'group',
  _actions: [
    'create',
  ],
  args: {
    initialIsOpen: true,
    withBorder: true,
  },
  children: [],
};

describe('POST /custom-tutorials', () => {
  requirements('rte.serverType=local');

  before(async () => {
    await fsExtra.remove(customTutorialsFolder);
    await (await localDb.getRepository(localDb.repositories.CUSTOM_TUTORIAL)).clear();
  });

  describe('Common', () => {
    it('should import tutorial from file and generate _manifest.json', async () => {
      const zip = getZipArchive();
      zip.writeZip(path.join(staticsFolder, 'test_no_manifest.zip'));

      // create tutorial
      await validateApiCall({
        endpoint: creatEndpoint,
        attach: ['file', zip.toBuffer(), 'a.zip'],
        statusCode: 201,
        checkFn: async ({ body }) => {
          const tutorialRootManifest = {
            ...autoGeneratedManifest,
            type: 'group',
            id: body.id,
            label: 'a',
            _actions: [ 'delete' ],
            _path: `/${body.id}`,
          };

          globalManifest.children = [tutorialRootManifest].concat(globalManifest.children);

          expect(body).deep.eq(tutorialRootManifest);
          checkFilesUnarchivedFiles(zip, body?._path);
          expect(JSON.parse(await fsExtra.readFile(path.join(customTutorialsFolder, body._path, '_manifest.json'), 'utf8')))
            .deep.eq(_.omit(body, ['_actions', '_path', 'id', 'label', 'type']));
          expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(1);
        },
      });

      // global manifest
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body).deep.eq(globalManifest);
        },
      });
    });

    it('should import tutorial from file with manifest', async () => {
      const zip = getZipArchive();
      zip.addFile('manifest.json', Buffer.from(JSON.stringify(testManifest), 'utf8'));
      zip.writeZip(path.join(staticsFolder, 'test.zip'));

      await validateApiCall({
        endpoint: creatEndpoint,
        attach: ['file', zip.toBuffer(), 'a.zip'],
        statusCode: 201,
        checkFn: async ({ body }) => {
          const tutorialRootManifest = {
            ...testManifest,
            type: 'group',
            id: body.id,
            _actions: [ 'delete' ],
            _path: `/${body.id}`,
          };

          globalManifest.children = [tutorialRootManifest].concat(globalManifest.children);

          expect(body).deep.eq(tutorialRootManifest);
          checkFilesUnarchivedFiles(zip, body?._path);
          expect({
            ...JSON.parse(await fsExtra.readFile(path.join(customTutorialsFolder, body._path, 'manifest.json'), 'utf8')),
            id: body.id,
          }).deep.eq({
            ...(_.omit(body, ['_actions', '_path'])),
          });
          expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(2);
        },
      });

      // global manifest
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body).deep.eq(globalManifest);
        },
      });
    });

    it('should import tutorial from the external link with manifest', async () => {
      const zip = new AdmZip(path.join(staticsFolder, 'test.zip'));
      const link = `${getBaseURL()}/static/test.zip`;

      await validateApiCall({
        endpoint: creatEndpoint,
        fields: [
          ['link', link],
        ],
        statusCode: 201,
        checkFn: async ({ body }) => {
          const tutorialRootManifest = {
            ...testManifest,
            type: 'group',
            id: body.id,
            _actions: [ 'delete', 'sync' ],
            _path: `/${body.id}`,
          };

          globalManifest.children = [tutorialRootManifest].concat(globalManifest.children);

          expect(body).deep.eq(tutorialRootManifest);
          checkFilesUnarchivedFiles(zip, body?._path);
          expect({
            ...JSON.parse(await fsExtra.readFile(path.join(customTutorialsFolder, body._path, 'manifest.json'), 'utf8')),
            id: body.id,
          }).deep.eq({
            ...(_.omit(body, ['_actions', '_path'])),
          });
          expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(3);
        },
      });

      // global manifest
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body).deep.eq(globalManifest);
        },
      });
    });

    it('should delete tutorial', async () => {
      expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(3);
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body.children.length).eq(3);
        },
      });

      const toDelete = globalManifest.children.shift();
      await validateApiCall({
        endpoint: deleteEndpoint(toDelete.id),
      });

      expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(2);
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body.children.length).eq(2);
          expect(body).deep.eq(globalManifest);
        },
      });
    });

    it('should delete tutorial and not fail even if folder does not exist', async () => {
      expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(2);
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body.children.length).eq(2);
        },
      });

      const toDelete = globalManifest.children.shift();

      await fsExtra.remove(path.join(customTutorialsFolder, toDelete.id));
      expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(1);

      await validateApiCall({
        endpoint: deleteEndpoint(toDelete.id),
      });

      expect((await fsExtra.readdir(customTutorialsFolder)).length).eq(1);
      await validateApiCall({
        endpoint: manifestEndpoint,
        checkFn: async ({ body }) => {
          expect(body.children.length).eq(1);
          expect(body).deep.eq(globalManifest);
        },
      });
    });

    it('should fail when trying to delete not existing tutorial', async () => {
      await validateApiCall({
        endpoint: deleteEndpoint('not existing'),
        statusCode: 404,
        responseBody: {
          statusCode: 404,
          message: 'Custom Tutorial was not found.',
          error: 'Not Found',
        }
      });
    });
  });
});
