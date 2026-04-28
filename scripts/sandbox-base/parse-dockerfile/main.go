package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/moby/buildkit/frontend/dockerfile/parser"
)

type parsedDockerfile struct {
	Stages []parsedStage `json:"stages"`
}

type parsedStage struct {
	Name         string              `json:"name"`
	BaseImage    string              `json:"baseImage"`
	Instructions []parsedInstruction `json:"instructions"`
}

type parsedInstruction struct {
	Kind      string   `json:"kind"`
	Value     string   `json:"value"`
	Flags     []string `json:"flags"`
	StartLine int      `json:"startLine"`
	EndLine   int      `json:"endLine"`
}

func main() {
	dockerfilePath := flag.String("dockerfile", "", "Dockerfile path to parse")
	flag.Parse()

	if *dockerfilePath == "" {
		exitWithError("missing required --dockerfile path")
	}

	input, err := readDockerfile(*dockerfilePath)
	if err != nil {
		exitWithError("%v", err)
	}

	result, err := parser.Parse(bytes.NewReader(input))
	if err != nil {
		exitWithError("parse Dockerfile: %v", err)
	}

	parsed, err := parseDockerfile(result.AST)
	if err != nil {
		exitWithError("%v", err)
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(parsed); err != nil {
		exitWithError("encode parsed Dockerfile: %v", err)
	}
}

func readDockerfile(dockerfilePath string) ([]byte, error) {
	if dockerfilePath == "-" {
		input, err := io.ReadAll(os.Stdin)
		if err != nil {
			return nil, fmt.Errorf("read Dockerfile from stdin: %w", err)
		}
		return input, nil
	}

	input, err := os.ReadFile(dockerfilePath)
	if err != nil {
		return nil, fmt.Errorf("read Dockerfile: %w", err)
	}
	return input, nil
}

func parseDockerfile(root *parser.Node) (parsedDockerfile, error) {
	if root == nil {
		return parsedDockerfile{}, fmt.Errorf("Dockerfile parser returned an empty AST")
	}

	stages := []parsedStage{}
	var currentStage *parsedStage

	for _, node := range root.Children {
		kind := strings.ToUpper(node.Value)
		value := strings.Join(readNodeArguments(node), " ")
		instruction := parsedInstruction{
			EndLine:   node.EndLine,
			Flags:     append([]string{}, node.Flags...),
			Kind:      kind,
			StartLine: node.StartLine,
			Value:     value,
		}

		if kind == "FROM" {
			baseImage, stageName, err := parseFromInstruction(node)
			if err != nil {
				return parsedDockerfile{}, err
			}

			stages = append(stages, parsedStage{
				BaseImage:    baseImage,
				Instructions: []parsedInstruction{instruction},
				Name:         stageName,
			})
			currentStage = &stages[len(stages)-1]
			continue
		}

		if currentStage == nil {
			continue
		}

		currentStage.Instructions = append(currentStage.Instructions, instruction)
	}

	return parsedDockerfile{Stages: stages}, nil
}

func parseFromInstruction(node *parser.Node) (string, string, error) {
	arguments := readNodeArguments(node)
	if len(arguments) == 0 {
		return "", "", fmt.Errorf("FROM instruction at line %d has no base image", node.StartLine)
	}

	baseImage := arguments[0]
	stageName := ""

	if len(arguments) >= 3 && strings.EqualFold(arguments[len(arguments)-2], "AS") {
		stageName = arguments[len(arguments)-1]
	}

	return baseImage, stageName, nil
}

func readNodeArguments(node *parser.Node) []string {
	arguments := []string{}
	for child := node.Next; child != nil; child = child.Next {
		appendNodeValues(&arguments, child)
	}
	return arguments
}

func appendNodeValues(arguments *[]string, node *parser.Node) {
	if node.Value != "" {
		*arguments = append(*arguments, node.Value)
	}

	for _, child := range node.Children {
		appendNodeValues(arguments, child)
	}
}

func exitWithError(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
