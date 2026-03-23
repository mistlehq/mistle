{{/*
Common helpers for the Mistle Helm chart.
*/}}

{{- define "mistle.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "mistle.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "mistle.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "mistle.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "mistle.namespace" -}}
{{- if .Values.global.namespaceOverride -}}
{{- .Values.global.namespaceOverride -}}
{{- else -}}
{{- .Release.Namespace -}}
{{- end -}}
{{- end -}}

{{- define "mistle.labels" -}}
helm.sh/chart: {{ include "mistle.chart" . }}
app.kubernetes.io/name: {{ include "mistle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "mistle.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mistle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "mistle.componentLabels" -}}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "mistle.componentSelectorLabels" -}}
{{ include "mistle.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "mistle.componentName" -}}
{{- printf "%s-%s" (include "mistle.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "mistle.image" -}}
{{- $repository := required "image.repository is required" .image.repository -}}
{{- $imageName := $repository -}}
{{- if and .root.Values.global.imageRegistry .image.useGlobalRegistry -}}
{{- $imageName = printf "%s/%s" .root.Values.global.imageRegistry $repository -}}
{{- end -}}
{{- if .image.digest -}}
{{- printf "%s@%s" $imageName .image.digest -}}
{{- else -}}
{{- printf "%s:%s" $imageName (required "Either image.tag or image.digest must be set" .image.tag) -}}
{{- end -}}
{{- end -}}

{{- define "mistle.renderEnv" -}}
{{- range . }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}
{{- end -}}

{{- define "mistle.renderSecretEnv" -}}
{{- range . }}
- name: {{ .name }}
  valueFrom:
    secretKeyRef:
      name: {{ .secretName }}
      key: {{ .secretKey }}
      {{- if hasKey . "optional" }}
      optional: {{ .optional }}
      {{- end }}
{{- end }}
{{- end -}}

{{- define "mistle.renderVolumes" -}}
{{- range . }}
- name: {{ .name }}
  {{- if .hostPath }}
  hostPath:
    path: {{ .hostPath.path | quote }}
    {{- with .hostPath.type }}
    type: {{ . }}
    {{- end }}
  {{- end }}
  {{- if .emptyDir }}
  emptyDir:
    {{- toYaml .emptyDir | nindent 4 }}
  {{- end }}
  {{- if .configMap }}
  configMap:
    {{- toYaml .configMap | nindent 4 }}
  {{- end }}
  {{- if .secret }}
  secret:
    {{- toYaml .secret | nindent 4 }}
  {{- end }}
{{- end }}
{{- end -}}

{{- define "mistle.renderVolumeMounts" -}}
{{- range . }}
- name: {{ .name }}
  mountPath: {{ .mountPath | quote }}
  {{- with .readOnly }}
  readOnly: {{ . }}
  {{- end }}
  {{- with .subPath }}
  subPath: {{ . | quote }}
  {{- end }}
{{- end }}
{{- end -}}

{{- define "mistle.workload" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $values := .values -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "mistle.componentName" (dict "root" $root "component" $component) }}
  namespace: {{ include "mistle.namespace" $root }}
  labels:
    {{- include "mistle.labels" $root | nindent 4 }}
    {{- include "mistle.componentLabels" (dict "root" $root "component" $component) | nindent 4 }}
spec:
  replicas: {{ $values.replicaCount }}
  selector:
    matchLabels:
      {{- include "mistle.componentSelectorLabels" (dict "root" $root "component" $component) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "mistle.componentSelectorLabels" (dict "root" $root "component" $component) | nindent 8 }}
      {{- with $root.Values.global.podAnnotations }}
      annotations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
    spec:
      {{- if $root.Values.global.serviceAccountName }}
      serviceAccountName: {{ $root.Values.global.serviceAccountName }}
      {{- end }}
      {{- with $root.Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- range . }}
        - name: {{ . }}
        {{- end }}
      {{- end }}
      containers:
        - name: {{ $component }}
          image: {{ include "mistle.image" (dict "root" $root "image" $values.image) }}
          imagePullPolicy: {{ $values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ $values.containerPort }}
          {{- with $values.volumeMounts }}
          volumeMounts:
            {{- include "mistle.renderVolumeMounts" . | nindent 12 }}
          {{- end }}
          {{- if or $values.env $values.secretEnv }}
          env:
            {{- if $values.env }}
            {{- include "mistle.renderEnv" $values.env | nindent 12 }}
            {{- end }}
            {{- if $values.secretEnv }}
            {{- include "mistle.renderSecretEnv" $values.secretEnv | nindent 12 }}
            {{- end }}
          {{- end }}
          {{- with $values.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $values.readinessProbe }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $values.livenessProbe }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $values.startupProbe }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
      {{- with $values.volumes }}
      volumes:
        {{- include "mistle.renderVolumes" . | nindent 8 }}
      {{- end }}
{{- end -}}

{{- define "mistle.service" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $values := .values -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "mistle.componentName" (dict "root" $root "component" $component) }}
  namespace: {{ include "mistle.namespace" $root }}
  labels:
    {{- include "mistle.labels" $root | nindent 4 }}
    {{- include "mistle.componentLabels" (dict "root" $root "component" $component) | nindent 4 }}
spec:
  type: {{ $values.service.type }}
  selector:
    {{- include "mistle.componentSelectorLabels" (dict "root" $root "component" $component) | nindent 4 }}
  ports:
    - name: http
      port: {{ $values.service.port }}
      targetPort: {{ default $values.containerPort $values.service.targetPort }}
{{- end -}}

{{- define "mistle.ingress" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $values := .values -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "mistle.componentName" (dict "root" $root "component" $component) }}
  namespace: {{ include "mistle.namespace" $root }}
  labels:
    {{- include "mistle.labels" $root | nindent 4 }}
    {{- include "mistle.componentLabels" (dict "root" $root "component" $component) | nindent 4 }}
  {{- with $values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if $values.ingress.className }}
  ingressClassName: {{ $values.ingress.className }}
  {{- end }}
  rules:
    - host: {{ required (printf "%s ingress.host is required when ingress is enabled" $component) $values.ingress.host }}
      http:
        paths:
          - path: {{ $values.ingress.path }}
            pathType: {{ $values.ingress.pathType }}
            backend:
              service:
                name: {{ include "mistle.componentName" (dict "root" $root "component" $component) }}
                port:
                  number: {{ $values.service.port }}
  {{- with $values.ingress.tls }}
  tls:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end -}}
