import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from 'reactflow';
import { X } from 'lucide-react';
import { useStore } from '../store';

export const SoftEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}) => {
  const [hovered, setHovered] = useState(false);
  const removeEdge = useStore((state) => state.removeEdge);
  const pushNotice = useStore((state) => state.pushNotice);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = hovered || selected;
  const idleStroke = typeof style?.stroke === 'string' ? style.stroke : 'var(--edge-color)';
  const idleOpacity = typeof style?.opacity === 'number' ? style.opacity : 0.62;

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: isActive ? 'var(--edge-active)' : idleStroke,
          strokeWidth: isActive ? 2 : 1.5,
          strokeDasharray: isActive ? '0' : '7 7',
          opacity: isActive ? 0.96 : idleOpacity,
          transition: 'stroke 140ms ease, stroke-width 140ms ease, opacity 140ms ease',
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            aria-label="Disconnect edge"
            className="soft-edge-delete"
            data-visible={isActive ? 'true' : 'false'}
            onClick={(event) => {
              event.stopPropagation();
              removeEdge(id);
              pushNotice('info', '连线已断开');
            }}
          >
            <X size={10} strokeWidth={2.4} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
