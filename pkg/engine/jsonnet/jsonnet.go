package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"strings"

	"github.com/google/go-jsonnet"
	"github.com/google/go-jsonnet/ast"
	"github.com/mitchellh/mapstructure"
	"gopkg.in/yaml.v3"
	"xorkevin.dev/playground/pkg/kjson"
)

var ErrInvalidArgs = errors.New("Invalid args")

type (
	// Engine is a jsonnet config engine
	Engine struct {
		fsys map[string]string
	}

	// NativeFunc is a jsonnet function implemented in go
	NativeFunc struct {
		Name   string
		Fn     func(args []any) (any, error)
		Params []string
	}

	// Opt are jsonnet engine constructor options
	Opt = func(e *Engine)
)

// New creates a new [*Engine] which is rooted at a particular file system
func New(fsys map[string]string) *Engine {
	return &Engine{
		fsys: fsys,
	}
}

var nativeFuncs = []NativeFunc{
	{
		Name: "log",
		Fn: func(args []any) (any, error) {
			b, err := kjson.Marshal(args)
			if err != nil {
				return nil, fmt.Errorf("Failed to marshal logs: %w", err)
			}
			var buf bytes.Buffer
			if err := json.Indent(&buf, []byte(b), "", "  "); err != nil {
				return nil, fmt.Errorf("Error formatting logs: %w", err)
			}
			if _, err := buf.WriteTo(os.Stderr); err != nil {
				return nil, fmt.Errorf("Failed writing logs: %w", err)
			}
			return true, nil
		},
		Params: []string{"str", "rest"},
	},
	{
		Name: "jsonMarshal",
		Fn: func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("%w: jsonMarshal needs 1 argument", ErrInvalidArgs)
			}
			b, err := kjson.Marshal(args[0])
			if err != nil {
				return nil, fmt.Errorf("Failed to marshal json: %w", err)
			}
			return string(b), nil
		},
		Params: []string{"v"},
	},
	{
		Name: "jsonUnmarshal",
		Fn: func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("%w: jsonUnmarshal needs 1 argument", ErrInvalidArgs)
			}
			a, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("%w: JSON must be a string", ErrInvalidArgs)
			}
			// jsonnet treats all numbers as float64, therefore no need to decode
			// as number. It also does not handle [json.Number].
			var v any
			if err := json.Unmarshal([]byte(a), &v); err != nil {
				return nil, fmt.Errorf("Failed to unmarshal json: %w", err)
			}
			return v, nil
		},
		Params: []string{"v"},
	},
	{
		Name: "jsonMergePatch",
		Fn: func(args []any) (any, error) {
			if len(args) != 2 {
				return nil, fmt.Errorf("%w: jsonMergePatch needs 2 arguments", ErrInvalidArgs)
			}
			return kjson.MergePatch(args[0], args[1]), nil
		},
		Params: []string{"a", "b"},
	},
	{
		Name: "jsonMergePatchAll",
		Fn: func(args []any) (any, error) {
			if len(args) != 2 {
				return nil, fmt.Errorf("%w: jsonMergePatchAll needs 2 arguments", ErrInvalidArgs)
			}
			return kjson.MergePatchAll(args[0], args[1]), nil
		},
		Params: []string{"a", "b"},
	},
	{
		Name: "yamlMarshal",
		Fn: func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("%w: yamlMarshal needs 1 argument", ErrInvalidArgs)
			}
			b, err := yaml.Marshal(args[0])
			if err != nil {
				return nil, fmt.Errorf("Failed to marshal yaml: %w", err)
			}
			return string(b), nil
		},
		Params: []string{"v"},
	},
	{
		Name: "yamlUnmarshal",
		Fn: func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("%w: yamlUnmarshal needs 1 argument", ErrInvalidArgs)
			}
			a, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("%w: YAML must be a string", ErrInvalidArgs)
			}
			var v any
			if err := yaml.Unmarshal([]byte(a), &v); err != nil {
				return nil, fmt.Errorf("Failed to unmarshal yaml: %w", err)
			}
			return v, nil
		},
		Params: []string{"v"},
	},
	{
		Name: "pathJoin",
		Fn: func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("%w: pathJoin needs 1 argument", ErrInvalidArgs)
			}
			var segments []string
			if err := mapstructure.Decode(args[0], &segments); err != nil {
				return nil, fmt.Errorf("%w: Path segments must be an array of strings: %w", ErrInvalidArgs, err)
			}
			return path.Join(segments...), nil
		},
		Params: []string{"v"},
	},
	{
		Name: "sha256hex",
		Fn: func(args []any) (any, error) {
			if len(args) != 1 {
				return nil, fmt.Errorf("%w: sha256hex needs 1 argument", ErrInvalidArgs)
			}
			data, ok := args[0].(string)
			if !ok {
				return nil, fmt.Errorf("%w: sha256hex must have string argument", ErrInvalidArgs)
			}
			h := sha256.Sum256([]byte(data))
			return hex.EncodeToString(h[:]), nil
		},
		Params: []string{"v"},
	},
}

func (e *Engine) buildVM(strout bool, stderr io.Writer) *jsonnet.VM {
	if stderr == nil {
		stderr = io.Discard
	}

	vm := jsonnet.MakeVM()
	vm.SetTraceOut(stderr)
	vm.StringOutput = strout

	var stdlib strings.Builder
	stdlib.WriteString("{\n")

	for _, v := range nativeFuncs {
		paramstr := ""
		var params ast.Identifiers
		if len(v.Params) > 0 {
			paramstr = strings.Join(v.Params, ", ")
			params = make(ast.Identifiers, 0, len(v.Params))
			for _, i := range v.Params {
				params = append(params, ast.Identifier(i))
			}
		}
		vm.NativeFunction(&jsonnet.NativeFunction{
			Name:   v.Name,
			Func:   v.Fn,
			Params: params,
		})
		stdlib.WriteString(v.Name)
		stdlib.WriteString("(")
		stdlib.WriteString(paramstr)
		stdlib.WriteString(`):: std.native("`)
		stdlib.WriteString(v.Name)
		stdlib.WriteString(`")(`)
		stdlib.WriteString(paramstr)
		stdlib.WriteString("),\n")
	}
	stdlib.WriteString("}\n")
	vm.Importer(newFSImporter(e.fsys, "native:std", stdlib.String()))
	return vm
}

// Exec implements [confengine.ConfEngine] and generates config using jsonnet
func (e *Engine) Exec(name string, strout bool, stderr io.Writer) (string, error) {
	vm := e.buildVM(strout, stderr)
	b, err := vm.EvaluateFile(name)
	if err != nil {
		return "", fmt.Errorf("Failed to execute jsonnet: %w", err)
	}
	return b, nil
}

type (
	fsImporter struct {
		root          map[string]string
		contentsCache map[string]*fsContents
		libname       string
		stl           jsonnet.Contents
	}

	fsContents struct {
		contents jsonnet.Contents
		err      error
	}
)

func newFSImporter(root map[string]string, libname string, stl string) *fsImporter {
	return &fsImporter{
		root:          root,
		contentsCache: map[string]*fsContents{},
		libname:       libname,
		stl:           jsonnet.MakeContents(stl),
	}
}

func (f *fsImporter) importFile(fspath string) (jsonnet.Contents, error) {
	if c, ok := f.contentsCache[fspath]; ok {
		return c.contents, c.err
	}
	var c jsonnet.Contents
	var err error
	b, ok := f.root[fspath]
	if ok {
		c = jsonnet.MakeContents(b)
	} else {
		err = fmt.Errorf("%w: File not found", fs.ErrNotExist)
	}
	f.contentsCache[fspath] = &fsContents{
		contents: c,
		err:      err,
	}
	return c, err
}

// Import implements [github.com/google/go-jsonnet.Importer]
func (f *fsImporter) Import(importedFrom, importedPath string) (jsonnet.Contents, string, error) {
	if importedPath == f.libname {
		return f.stl, f.libname, nil
	}

	var name string
	if path.IsAbs(importedPath) {
		// make absolute paths relative to the root fs
		name = path.Clean(importedPath[1:])
	} else {
		// paths are otherwise relative to the file importing them
		name = path.Join(path.Dir(importedFrom), importedPath)
	}
	if !fs.ValidPath(name) {
		return jsonnet.Contents{}, "", fmt.Errorf("%w: Invalid filepath %s from %s", fs.ErrInvalid, importedPath, importedFrom)
	}
	c, err := f.importFile(name)
	if err != nil {
		return jsonnet.Contents{}, "", fmt.Errorf("Failed to read file %s: %w", name, err)
	}
	return c, name, err
}

type (
	StdinConfig struct {
		Files  map[string]string `json:"files"`
		StrOut bool              `json:"strout"`
	}
)

func runJsonnet() error {
	stdinbuf, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("Failed reading input: %w", err)
	}
	var cfg StdinConfig
	if err := kjson.Unmarshal(stdinbuf, &cfg); err != nil {
		return fmt.Errorf("Malformed input: %w", err)
	}
	eng := New(cfg.Files)
	out, err := eng.Exec("main.jsonnet", cfg.StrOut, os.Stderr)
	if err != nil {
		return fmt.Errorf("Error executing jsonnet: %w", err)
	}
	if !cfg.StrOut {
		var buf bytes.Buffer
		if err := json.Indent(&buf, []byte(out), "", "  "); err != nil {
			return fmt.Errorf("Error indenting jsonnet: %w", err)
		}
		if _, err := buf.WriteTo(os.Stdout); err != nil {
			return fmt.Errorf("Failed writing output: %w", err)
		}
	} else {
		if _, err := fmt.Fprintln(os.Stdout, out); err != nil {
			return fmt.Errorf("Failed writing output: %w", err)
		}
	}
	return nil
}

func main() {
	if err := runJsonnet(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
		return
	}
}
