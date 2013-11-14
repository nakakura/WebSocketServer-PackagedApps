
class Sha1{
    private _chain: number[] = [];
    private _buf: number[] = [];
    private _W: number[] = [];
    private _pad: number[] = [];
    private _inbuf: number;
    private _total: number;

    constructor(){
        this._pad[0] = 128;
        for (var i = 1; i < 64; ++i) {
            this._pad.push(0);
        }

        this.reset();
    }

    public reset(): void{
        this._chain[0] = 0x67452301;
        this._chain[1] = 0xefcdab89;
        this._chain[2] = 0x98badcfe;
        this._chain[3] = 0x10325476;
        this._chain[4] = 0xc3d2e1f0;

        this._inbuf = 0;
        this._total = 0;
    }

    private _rotl(w: number, r: number): number{
        return ((w << r) | (w >>> (32 - r))) & 0xffffffff;
    }

    private _compress(buf: number[]){
        var W: number[] = this._W;

        // get 16 big endian words
        for (var i = 0; i < 64; i += 4) {
            var w = (buf[i] << 24) |
                (buf[i + 1] << 16) |
                (buf[i + 2] << 8) |
                (buf[i + 3]);
            W[i / 4] = w;
        }

        // expand to 80 words
        for (var i = 16; i < 80; i++) {
            W[i] = this._rotl(W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16], 1);
        }

        var a: number = this._chain[0];
        var b: number  = this._chain[1];
        var c: number  = this._chain[2];
        var d: number  = this._chain[3];
        var e: number  = this._chain[4];
        var f: number , k: number ;

        for (var i = 0; i < 80; i++) {
            if (i < 40) {
                if (i < 20) {
                    f = d ^ (b & (c ^ d));
                    k = 0x5a827999;
                } else {
                    f = b ^ c ^ d;
                    k = 0x6ed9eba1;
                }
            } else {
                if (i < 60) {
                    f = (b & c) | (d & (b | c));
                    k = 0x8f1bbcdc;
                } else {
                    f = b ^ c ^ d;
                    k = 0xca62c1d6;
                }
            }

            var t: number = (this._rotl(a, 5) + f + e + k + W[i]) & 0xffffffff;
            e = d;
            d = c;
            c = this._rotl(b, 30);
            b = a;
            a = t;
        }

        this._chain[0] = (this._chain[0] + a) & 0xffffffff;
        this._chain[1] = (this._chain[1] + b) & 0xffffffff;
        this._chain[2] = (this._chain[2] + c) & 0xffffffff;
        this._chain[3] = (this._chain[3] + d) & 0xffffffff;
        this._chain[4] = (this._chain[4] + e) & 0xffffffff;
    }

    public update(bytes: number[], opt_length: number) {
        if (!opt_length) {
            opt_length = bytes.length;
        }

        var n: number = 0;

        // Optimize for 64 byte chunks at 64 byte boundaries.
        if (this._inbuf == 0) {
            while (n + 64 < opt_length) {
                this._compress(bytes.slice(n, n + 64));
                n += 64;
                this._total += 64;
            }
        }

        while (n < opt_length) {
            this._buf[this._inbuf++] = bytes[n++];
            this._total++;

            if (this._inbuf == 64) {
                this._inbuf = 0;
                this._compress(this._buf);

                // Pick up 64 byte chunks.
                while (n + 64 < opt_length) {
                    this._compress(bytes.slice(n, n + 64));
                    n += 64;
                    this._total += 64;
                }
            }
        }
    }

    public digest(): number[]{
        var digest: number[] = [];
        var totalBits = this._total * 8;

        // Add pad 0x80 0x00*.
        if (this._inbuf < 56) {
            this.update(this._pad, 56 - this._inbuf);
        } else {
            this.update(this._pad, 64 - (this._inbuf - 56));
        }

        // Add # bits.
        for (var i = 63; i >= 56; i--) {
            this._buf[i] = totalBits & 255;
            totalBits >>>= 8;
        }

        this._compress(this._buf);

        var n: number = 0;
        for (var i = 0; i < 5; i++) {
            for (var j = 24; j >= 0; j -= 8) {
                digest[n++] = (this._chain[i] >> j) & 255;
            }
        }

        return digest;
    }
}