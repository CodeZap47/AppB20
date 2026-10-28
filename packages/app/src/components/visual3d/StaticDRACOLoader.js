// Adapted from Three.js 0.186.1 (MIT). See vendor/THREE-LICENSE.txt.
import {
	BufferAttribute,
	BufferGeometry,
	Color,
	ColorManagement,
	FileLoader,
	Loader,
	LinearSRGBColorSpace,
	SRGBColorSpace,
	InterleavedBuffer,
	InterleavedBufferAttribute,
	LoaderUtils
} from 'three';

const _taskCache = new WeakMap();

const WASM_BIN_URL = new URL('./vendor/draco_decoder.wasm', import.meta.url).href;
const WASM_JS_URL = '';
const JS_URL = '';

const DRACO_GLTF_CONFIG = {
	js: '',
	wasm: WASM_BIN_URL,
};

/**
 * A loader for the Draco format.
 *
 * [Draco](https://google.github.io/draco/) is an open source library for compressing
 * and decompressing 3D meshes and point clouds. Compressed geometry can be significantly smaller,
 * at the cost of additional decoding time on the client device.
 *
 * Standalone Draco files have a `.drc` extension, and contain vertex positions, normals, colors,
 * and other attributes. Draco files do not contain materials, textures, animation, or node hierarchies –
 * to use these features, embed Draco geometry inside of a glTF file. A normal glTF file can be converted
 * to a Draco-compressed glTF file using [glTF-Pipeline](https://github.com/CesiumGS/gltf-pipeline).
 * When using Draco with glTF, an instance of `DRACOLoader` will be used internally by {@link GLTFLoader}.
 *
 * It is recommended to create one DRACOLoader instance and reuse it to avoid loading and creating
 * multiple decoder instances.
 *
 * `DRACOLoader` will automatically use either the JS or the WASM decoding library, based on
 * browser capabilities.
 *
 * ```js
 * const loader = new DRACOLoader();
 * const geometry = await loader.loadAsync( 'models/draco/bunny.drc' );
 * geometry.computeVertexNormals(); // optional
 *
 * loader.dispose();
 * ```
 *
 * @augments Loader
 * @three_import import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
 */
class DRACOLoader extends Loader {

	/**
	 * Constructs a new Draco loader.
	 *
	 * @param {LoadingManager} [manager] - The loading manager.
	 */
	constructor( manager ) {

		super( manager );

		this.decoderPaths = {
			js: WASM_JS_URL,
			wasm: WASM_BIN_URL,
			dep_js: JS_URL,
		};
		this.decoderConfig = {};
		this.decoderBinary = null;
		this.decoderPending = null;

		this.workerLimit = 4;
		this.workerPool = [];
		this.workerNextTaskID = 1;
		this.workerSourceURL = '';

		this.defaultAttributeIDs = {
			position: 'POSITION',
			normal: 'NORMAL',
			color: 'COLOR',
			uv: 'TEX_COORD'
		};
		this.defaultAttributeTypes = {
			position: 'Float32Array',
			normal: 'Float32Array',
			color: 'Float32Array',
			uv: 'Float32Array'
		};

	}

	/**
	 * Provides configuration for the decoder libraries. Configuration cannot be changed after decoding begins.
	 *
	 * @param {string|{js:string, wasm:string}} path - The decoder path, or a config object with explicit URLs for each decoder file.
	 * @return {DRACOLoader} A reference to this loader.
	 */
	setDecoderPath( path ) {

		const { decoderPaths } = this;
		if ( typeof path === 'object' ) {

			decoderPaths.js = path.js;
			decoderPaths.wasm = path.wasm;
			decoderPaths.dep_js = null;

		} else {

			decoderPaths.js = LoaderUtils.resolveURL( 'draco_wasm_wrapper.js', path );
			decoderPaths.wasm = LoaderUtils.resolveURL( 'draco_decoder.wasm', path );
			decoderPaths.dep_js = LoaderUtils.resolveURL( 'draco_decoder.js', path );

		}

		return this;

	}

	/**
	 * Provides configuration for the decoder libraries. Configuration cannot be changed after decoding begins.
	 *
	 * @deprecated
	 * @param {{type:('js'|'wasm')}} config - The decoder config.
	 * @return {DRACOLoader} A reference to this loader.
	 */
	setDecoderConfig( config ) {

		console.warn( 'THREE.DRACOLoader: setDecoderConfig to has been deprecated and will be removed in r194.' );
		this.decoderConfig = config;

		return this;

	}

	/**
	 * Sets the maximum number of Web Workers to be used during decoding.
	 * A lower limit may be preferable if workers are also for other tasks in the application.
	 *
	 * @param {number} workerLimit - The worker limit.
	 * @return {DRACOLoader} A reference to this loader.
	 */
	setWorkerLimit( workerLimit ) {

		this.workerLimit = workerLimit;

		return this;

	}

	/**
	 * Starts loading from the given URL and passes the loaded Draco asset
	 * to the `onLoad()` callback.
	 *
	 * @param {string} url - The path/URL of the file to be loaded. This can also be a data URI.
	 * @param {function(BufferGeometry)} onLoad - Executed when the loading process has been finished.
	 * @param {onProgressCallback} onProgress - Executed while the loading is in progress.
	 * @param {onErrorCallback} onError - Executed when errors occur.
	 */
	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );

		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );

		loader.load( url, ( buffer ) => {

			this.parse( buffer, onLoad, onError );

		}, onProgress, onError );

	}

	/**
	 * Parses the given Draco data.
	 *
	 * @param {ArrayBuffer} buffer - The raw Draco data as an array buffer.
	 * @param {function(BufferGeometry)} onLoad - Executed when the loading/parsing process has been finished.
	 * @param {onErrorCallback} onError - Executed when errors occur.
	 */
	parse( buffer, onLoad, onError = ()=>{} ) {

		this.decodeDracoFile( buffer, onLoad, null, null, SRGBColorSpace, onError ).catch( onError );

	}

	//

	decodeDracoFile( buffer, callback, attributeIDs, attributeTypes, vertexColorSpace = LinearSRGBColorSpace, onError = () => {} ) {

		const taskConfig = {
			attributeIDs: attributeIDs || this.defaultAttributeIDs,
			attributeTypes: attributeTypes || this.defaultAttributeTypes,
			useUniqueIDs: !! attributeIDs,
			vertexColorSpace: vertexColorSpace,
		};

		return this.decodeGeometry( buffer, taskConfig ).then( callback ).catch( onError );

	}

	decodeGeometry( buffer, taskConfig ) {

		const taskKey = JSON.stringify( taskConfig );

		// Check for an existing task using this buffer. A transferred buffer cannot be transferred
		// again from this thread.
		if ( _taskCache.has( buffer ) ) {

			const cachedTask = _taskCache.get( buffer );

			if ( cachedTask.key === taskKey ) {

				return cachedTask.promise;

			} else if ( buffer.byteLength === 0 ) {

				// Technically, it would be possible to wait for the previous task to complete,
				// transfer the buffer back, and decode again with the second configuration. That
				// is complex, and I don't know of any reason to decode a Draco buffer twice in
				// different ways, so this is left unimplemented.
				throw new Error(

					'THREE.DRACOLoader: Unable to re-decode a buffer with different ' +
					'settings. Buffer has already been transferred.'

				);

			}

		}

		//

		let worker;
		const taskID = this.workerNextTaskID ++;
		const taskCost = buffer.byteLength;

		// Obtain a worker and assign a task, and construct a geometry instance
		// when the task completes.
		const geometryPending = this._getWorker( taskID, taskCost )
			.then( ( _worker ) => {

				worker = _worker;

				return new Promise( ( resolve, reject ) => {

					worker._callbacks[ taskID ] = { resolve, reject };

					worker.postMessage( { type: 'decode', id: taskID, taskConfig, buffer }, [ buffer ] );

					// this.debug();

				} );

			} )
			.then( ( message ) => this._createGeometry( message.geometry ) );

		// Remove task from the task list.
		// Note: replaced '.finally()' with '.catch().then()' block - iOS 11 support (#19416)
		geometryPending
			.catch( () => true )
			.then( () => {

				if ( worker && taskID ) {

					this._releaseTask( worker, taskID );

					// this.debug();

				}

			} );

		// Cache the task result.
		_taskCache.set( buffer, {

			key: taskKey,
			promise: geometryPending

		} );

		return geometryPending;

	}

	_createGeometry( geometryData ) {

		const geometry = new BufferGeometry();

		if ( geometryData.index ) {

			geometry.setIndex( new BufferAttribute( geometryData.index.array, 1 ) );

		}

		for ( let i = 0; i < geometryData.attributes.length; i ++ ) {

			const { name, array, itemSize, stride, vertexColorSpace } = geometryData.attributes[ i ];

			let attribute;

			if ( itemSize === stride ) {

				attribute = new BufferAttribute( array, itemSize );

			} else {

				const buffer = new InterleavedBuffer( array, stride );

				attribute = new InterleavedBufferAttribute( buffer, itemSize, 0 );

			}

			if ( name === 'color' ) {

				this._assignVertexColorSpace( attribute, vertexColorSpace );

				attribute.normalized = ( array instanceof Float32Array ) === false;

			}

			geometry.setAttribute( name, attribute );

		}

		return geometry;

	}

	_assignVertexColorSpace( attribute, inputColorSpace ) {

		// While .drc files do not specify colorspace, the only 'official' tooling
		// is PLY and OBJ converters, which use sRGB. We'll assume sRGB when a .drc
		// file is passed into .load() or .parse(). GLTFLoader uses internal APIs
		// to decode geometry, and vertex colors are already Linear-sRGB in there.

		if ( inputColorSpace !== SRGBColorSpace ) return;

		const _color = new Color();

		for ( let i = 0, il = attribute.count; i < il; i ++ ) {

			_color.fromBufferAttribute( attribute, i );
			ColorManagement.colorSpaceToWorking( _color, SRGBColorSpace );
			attribute.setXYZ( i, _color.r, _color.g, _color.b );

		}

	}

	_loadLibrary( url, responseType ) {

		const loader = new FileLoader( this.manager );
		loader.setResponseType( responseType );
		loader.setWithCredentials( this.withCredentials );

		return new Promise( ( resolve, reject ) => {

			loader.load( url, resolve, undefined, reject );

		} );

	}

	preload() {

		this._initDecoder();

		return this;

	}

	_initDecoder() {
		if (!this.decoderPending) this.decoderPending = fetch(WASM_BIN_URL).then(response => {
			if (!response.ok) throw new Error('No se pudo cargar el decodificador Draco.');
			return response.arrayBuffer();
		}).then(bytes => { this.decoderConfig.wasmBinary = bytes; });
		return this.decoderPending;
	}

	_getWorker( taskID, taskCost ) {

		return this._initDecoder().then( () => {

			if (this._disposed) throw new Error('La carga se canceló.');

			if ( this.workerPool.length < this.workerLimit ) {

				const worker = new Worker(new URL('./draco.worker.js', import.meta.url), { type: 'module' });

				worker._callbacks = {};
				worker.onerror = event => { for (const callback of Object.values(worker._callbacks)) callback.reject(new Error(event.message || 'Falló el decodificador Draco.')); };
				worker._taskCosts = {};
				worker._taskLoad = 0;

				worker.postMessage( { type: 'init', decoderConfig: this.decoderConfig } );

				worker.onmessage = function ( e ) {

					const message = e.data;

					switch ( message.type ) {

						case 'decode':
							worker._callbacks[ message.id ].resolve( message );
							break;

						case 'error':
							worker._callbacks[ message.id ].reject( message );
							break;

						default:
							console.error( 'THREE.DRACOLoader: Unexpected message, "' + message.type + '"' );

					}

				};

				this.workerPool.push( worker );

			} else {

				this.workerPool.sort( function ( a, b ) {

					return a._taskLoad > b._taskLoad ? - 1 : 1;

				} );

			}

			const worker = this.workerPool[ this.workerPool.length - 1 ];
			worker._taskCosts[ taskID ] = taskCost;
			worker._taskLoad += taskCost;
			return worker;

		} );

	}

	_releaseTask( worker, taskID ) {

		worker._taskLoad -= worker._taskCosts[ taskID ];
		delete worker._callbacks[ taskID ];
		delete worker._taskCosts[ taskID ];

	}

	debug() {

		console.log( 'Task load: ', this.workerPool.map( ( worker ) => worker._taskLoad ) );

	}

	dispose() {

		this._disposed = true;

		for ( let i = 0; i < this.workerPool.length; ++ i ) {

			for (const callback of Object.values(this.workerPool[i]._callbacks)) callback.reject(new Error('La carga se canceló.'));

			this.workerPool[ i ].terminate();

		}

		this.workerPool.length = 0;

		if ( this.workerSourceURL !== '' ) {

			URL.revokeObjectURL( this.workerSourceURL );

		}

		return this;

	}

}

export { DRACOLoader, DRACO_GLTF_CONFIG };
