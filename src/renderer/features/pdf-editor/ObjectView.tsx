import { memo } from 'react';
import { cssFontFamily } from '@shared/fonts';
import type { EditorObject, PathObject, ShapeObject, TextObject } from '@shared/types/objects';
import { arrowHead } from '../../engine/export/drawObjects';
import { effectiveVariant, useFontStore } from '../../engine/fonts/fontRegistry';
import { layoutText } from '../../engine/objects/textLayout';
import { getImageAsset } from '../../engine/rendering/pageRenderer';

/** SVG transform placing an object's local frame (origin at its top-left corner) on the page. */
export function objectTransform(object: EditorObject): string {
  const rotate = object.rotation ? ` rotate(${object.rotation} ${object.width / 2} ${object.height / 2})` : '';
  return `translate(${object.x} ${object.y})${rotate}`;
}

function TextContent({ object, hideText }: { object: TextObject; hideText: boolean }): React.JSX.Element {
  // Lay the text out again once its font has finished loading.
  useFontStore((state) => state.version);
  const { lines } = layoutText(object);
  const variant = effectiveVariant(object.fontFamily, object);
  return (
    <>
      {object.background && <rect width={object.width} height={object.height} fill={object.background} />}
      {!hideText && (
        <text
          fontFamily={cssFontFamily(object.fontFamily)}
          fontSize={object.fontSize}
          fontWeight={variant.bold ? 700 : 400}
          fontStyle={variant.italic ? 'italic' : 'normal'}
          style={{ fontSynthesis: 'none' }}
          fill={object.color}
          xmlSpace="preserve"
        >
          {lines.map((line, index) => (
            <tspan key={index} x={line.x} y={line.baseline}>
              {line.text}
            </tspan>
          ))}
        </text>
      )}
    </>
  );
}

function ShapeContent({ object }: { object: ShapeObject }): React.JSX.Element | null {
  const { width, height, stroke, strokeWidth } = object;
  const common = {
    stroke: stroke ?? 'none',
    strokeWidth,
    strokeDasharray: object.dashed ? `${strokeWidth * 3} ${strokeWidth * 2}` : undefined,
  };
  if (object.shape === 'rect') return <rect width={width} height={height} fill={object.fill ?? 'none'} {...common} />;
  if (object.shape === 'ellipse') {
    return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={object.fill ?? 'none'} {...common} />;
  }

  const start = object.flipped ? { x: 0, y: height } : { x: 0, y: 0 };
  const end = object.flipped ? { x: width, y: 0 } : { x: width, y: height };
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!stroke || length === 0) return null;
  if (object.shape === 'line') {
    return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeLinecap="round" {...common} />;
  }

  // Same construction as the PDF export, so the arrow looks identical in both.
  const head = arrowHead(strokeWidth);
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const headLength = Math.min(head.length, length);
  const base = { x: end.x - ux * headLength, y: end.y - uy * headLength };
  const left = `${base.x - (uy * head.width) / 2},${base.y + (ux * head.width) / 2}`;
  const right = `${base.x + (uy * head.width) / 2},${base.y - (ux * head.width) / 2}`;
  return (
    <>
      <line x1={start.x} y1={start.y} x2={base.x} y2={base.y} {...common} />
      <polygon points={`${end.x},${end.y} ${left} ${right}`} fill={stroke} />
    </>
  );
}

export function pathPoints(object: PathObject): string {
  const points: string[] = [];
  for (let index = 0; index + 1 < object.points.length; index += 2) {
    points.push(`${object.points[index]! * object.width},${object.points[index + 1]! * object.height}`);
  }
  // A single point is drawn as a dot.
  return points.length === 1 ? `${points[0]} ${points[0]}` : points.join(' ');
}

interface ObjectViewProps {
  object: EditorObject;
  /** True while the text of this object is being typed in the inline editor. */
  editing?: boolean;
  /** Locked objects (or objects on a locked layer) are drawn but ignore the pointer. */
  locked?: boolean;
}

/** Draws one object. Used by the editing canvas and, without interaction, by thumbnails. */
export const ObjectView = memo(function ObjectView({ object, editing = false, locked = false }: ObjectViewProps): React.JSX.Element {
  let content: React.ReactNode;
  if (object.type === 'text') {
    content = <TextContent object={object} hideText={editing} />;
  } else if (object.type === 'image') {
    const flip =
      object.flipX || object.flipY
        ? `translate(${object.flipX ? object.width : 0} ${object.flipY ? object.height : 0}) scale(${object.flipX ? -1 : 1} ${object.flipY ? -1 : 1})`
        : undefined;
    content = (
      <image
        href={getImageAsset(object.assetId)?.url}
        width={object.width}
        height={object.height}
        preserveAspectRatio="none"
        transform={flip}
      />
    );
  } else if (object.type === 'shape') {
    content = <ShapeContent object={object} />;
  } else if (object.type === 'note') {
    // A speech-bubble icon in the note's colour; the text lives in the comments panel.
    const { width: w, height: h } = object;
    content = (
      <>
        <path
          className="note-icon"
          d={`M1 2 Q1 1 2 1 H${w - 2} Q${w - 1} 1 ${w - 1} 2 V${h * 0.68} Q${w - 1} ${h * 0.72} ${w - 2} ${h * 0.72} H${w * 0.5} L${w * 0.25} ${h - 1} V${h * 0.72} H2 Q1 ${h * 0.72} 1 ${h * 0.68} Z`}
          fill={object.color}
        />
        <title>{object.text}</title>
      </>
    );
  } else if (object.type === 'link') {
    content = <rect className="link-area" width={object.width} height={object.height} />;
  } else {
    content = (
      <polyline
        points={pathPoints(object)}
        fill="none"
        stroke={object.stroke}
        strokeWidth={object.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <g
      className="editor-object"
      transform={objectTransform(object)}
      opacity={object.opacity}
      data-object-id={object.id}
      data-object-type={object.type}
      data-locked={locked || undefined}
      data-highlighter={object.type === 'path' && object.highlighter ? true : undefined}
    >
      {/* Transparent hit area: thin strokes and unfilled shapes stay easy to grab. */}
      <rect
        className="editor-object__hit"
        x={-3}
        y={-3}
        width={object.width + 6}
        height={object.height + 6}
        fill="transparent"
      />
      {content}
    </g>
  );
});
