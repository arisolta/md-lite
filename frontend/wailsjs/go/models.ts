export namespace main {
	
	export class FilePayload {
	    path: string;
	    name: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new FilePayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.content = source["content"];
	    }
	}
	export class FileStats {
	    wordCount: number;
	    charCount: number;
	    lineCount: number;
	    readingTimeMs: number;
	
	    static createFrom(source: any = {}) {
	        return new FileStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.wordCount = source["wordCount"];
	        this.charCount = source["charCount"];
	        this.lineCount = source["lineCount"];
	        this.readingTimeMs = source["readingTimeMs"];
	    }
	}

}

