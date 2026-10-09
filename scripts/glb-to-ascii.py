#!/usr/bin/env python3
"""Bake a GLB into text turntables. Offline only; requires Python + numpy."""
import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np


def load_mesh(file):
    blob = Path(file).read_bytes()
    if blob[:4] != b'glTF' or struct.unpack_from('<I', blob, 4)[0] != 2:
        raise ValueError('Expected a GLB version 2 file')
    chunks = {}
    offset = 12
    while offset < len(blob):
        size, kind = struct.unpack_from('<II', blob, offset)
        chunks[kind] = blob[offset + 8:offset + 8 + size]
        offset += 8 + size
    doc = json.loads(chunks[0x4E4F534A])
    binary = chunks[0x004E4942]
    types = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
    widths = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

    def accessor(index):
        item = doc['accessors'][index]
        if 'sparse' in item:
            raise ValueError('Sparse accessors are not supported')
        view = doc['bufferViews'][item['bufferView']]
        if view.get('buffer', 0) != 0:
            raise ValueError('External buffers are not supported')
        dtype = np.dtype(types[item['componentType']])
        width = widths[item['type']]
        return np.ndarray((item['count'], width), dtype=dtype, buffer=binary,
                          offset=view.get('byteOffset', 0) + item.get('byteOffset', 0),
                          strides=(view.get('byteStride', width * dtype.itemsize), dtype.itemsize)).copy()

    triangles = []

    def visit(index, parent):
        node = doc['nodes'][index]
        if 'matrix' in node:
            local = np.array(node['matrix']).reshape(4, 4).T
        else:
            x, y, z, w = node.get('rotation', [0, 0, 0, 1])
            local = np.eye(4)
            local[:3, :3] = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                             [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                             [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
            local[:3, :3] *= node.get('scale', [1, 1, 1])
            local[:3, 3] = node.get('translation', [0, 0, 0])
        world = parent @ local
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode', 4) != 4:
                    raise ValueError('Only triangle meshes are supported')
                if 'KHR_draco_mesh_compression' in primitive.get('extensions', {}):
                    raise ValueError('Decode Draco before baking')
                vertices = accessor(primitive['attributes']['POSITION'])
                vertices = np.c_[vertices, np.ones(len(vertices))] @ world.T
                indices = accessor(primitive['indices']).ravel() if 'indices' in primitive else np.arange(len(vertices))
                triangles.append(vertices[indices.reshape(-1, 3), :3])
        for child in node.get('children', []):
            visit(child, world)

    for node in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(node, np.eye(4))
    if not triangles:
        raise ValueError('No triangles found')
    mesh = np.concatenate(triangles)
    low, high = mesh.min(axis=(0, 1)), mesh.max(axis=(0, 1))
    return mesh - (low + high) / 2


def bake(mesh, width, height, count, tags=None, elevation=0, azimuth=0):
    radius = np.linalg.norm(mesh[:, :, [0, 2]], axis=2).max()
    extent_y = np.abs(mesh[:, :, 1]).max()
    pitch = math.radians(elevation)
    extent_y = extent_y * abs(math.cos(pitch)) + radius * abs(math.sin(pitch))
    scale = min((width - 4) / (2 * radius), (height - 2) / extent_y)
    ramp = np.array(list('.:-=+*#%@'))
    light = np.array([-0.4, 0.7, 0.6])
    light /= np.linalg.norm(light)
    frames = []
    color_frames = []
    for frame in range(count):
        angle = frame * 2 * math.pi / count + math.radians(azimuth)
        c, s = math.cos(angle), math.sin(angle)
        rotated = mesh @ np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])
        pitch = math.radians(elevation)
        cp, sp = math.cos(pitch), math.sin(pitch)
        rotated = rotated @ np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]])
        normals = np.cross(rotated[:, 1] - rotated[:, 0], rotated[:, 2] - rotated[:, 0])
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
        brightness = 0.22 + 0.78 * np.abs(normals @ light)
        screen = rotated.copy()
        screen[:, :, 0] = rotated[:, :, 0] * scale + (width - 1) / 2
        screen[:, :, 1] = -rotated[:, :, 1] * scale / 2 + (height - 1) / 2
        depth = np.full((height, width), -np.inf)
        pixels = np.full((height, width), ' ')
        colors = np.full((height, width), ' ')
        for index, (triangle, shade) in enumerate(zip(screen, brightness)):
            x0, y0, z0 = triangle[0]
            x1, y1, z1 = triangle[1]
            x2, y2, z2 = triangle[2]
            denominator = (y1-y2)*(x0-x2) + (x2-x1)*(y0-y2)
            if abs(denominator) < 1e-9:
                continue
            left, right = max(0, math.floor(min(x0,x1,x2))), min(width-1, math.ceil(max(x0,x1,x2)))
            top, bottom = max(0, math.floor(min(y0,y1,y2))), min(height-1, math.ceil(max(y0,y1,y2)))
            if left > right or top > bottom:
                continue
            yy, xx = np.mgrid[top:bottom+1, left:right+1]
            a = ((y1-y2)*(xx-x2)+(x2-x1)*(yy-y2))/denominator
            b = ((y2-y0)*(xx-x2)+(x0-x2)*(yy-y2))/denominator
            z = a*z0+b*z1+(1-a-b)*z2
            region = depth[top:bottom+1, left:right+1]
            mask = (a >= -1e-6) & (b >= -1e-6) & (a+b <= 1+1e-6) & (z > region)
            region[mask] = z[mask]
            pixels[top:bottom+1, left:right+1][mask] = ramp[min(len(ramp)-1, int(shade*(len(ramp)-1)))]
            if tags is not None:
                colors[top:bottom+1, left:right+1][mask] = str(tags[index])
        frames.append([''.join(row) for row in pixels])
        if tags is not None:
            color_frames.append([''.join(row) for row in colors])
    result = {'width': width, 'height': height, 'frames': frames}
    if tags is not None:
        result['colorFrames'] = color_frames
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('--output', required=True)
    parser.add_argument('--frames', type=int, default=24)
    parser.add_argument('--sizes', default='64x22,40x10,28x5',
                        help='Comma-separated character canvases, e.g. 43x13')
    parser.add_argument('--hero', help='Compose a hero GLB in front of this landscape')
    parser.add_argument('--colossus', help='Compose a colossus GLB opposite the hero')
    parser.add_argument('--frame-ms', type=int, default=125)
    parser.add_argument('--elevation', type=float, default=0)
    parser.add_argument('--azimuth', type=float, default=0)
    args = parser.parse_args()
    if not 2 <= args.frames <= 120:
        parser.error('--frames must be between 2 and 120')
    if not 50 <= args.frame_ms <= 2000:
        parser.error('--frame-ms must be between 50 and 2000')
    try:
        sizes = [tuple(map(int, size.split('x'))) for size in args.sizes.split(',')]
        if any(len(size) != 2 or not 8 <= size[0] <= 160 or not 4 <= size[1] <= 60 for size in sizes):
            raise ValueError('Invalid canvas size')
    except ValueError:
        parser.error('--sizes expects widths 8..160 and heights 4..60, e.g. 43x13')
    mesh = load_mesh(args.input)
    tags = None
    if bool(args.hero) != bool(args.colossus):
        parser.error('--hero and --colossus must be supplied together')
    if args.hero:
        # Reuse the actual generated meshes, positioning them on the landscape
        # base. This is an offline tableau, not a skeletal combat animation.
        mesh *= 10 / np.ptp(mesh[:, :, 0])
        mesh[:, :, 2] -= 1.5
        floor = mesh[:, :, 1].min() + 0.35
        parts = [mesh]
        tag_parts = [np.where(mesh[:, :, 1].mean(axis=1) < floor + 0.3, 3, 0)]
        for tag, (file, height, x, angle) in enumerate([(args.hero, 2.5, -2.5, math.pi/4),
                                       (args.colossus, 4.5, 2.5, -math.pi/4)], start=1):
            part = load_mesh(file)
            part *= height / np.ptp(part[:, :, 1])
            c, s = math.cos(angle), math.sin(angle)
            part = part @ np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])
            part[:, :, 0] += x
            part[:, :, 1] += floor - part[:, :, 1].min()
            part[:, :, 2] += 3
            parts.append(part)
            tag_parts.append(np.full(len(part), tag))
        mesh = np.concatenate(parts)
        tags = np.concatenate(tag_parts)
        mesh -= (mesh.min(axis=(0, 1)) + mesh.max(axis=(0, 1))) / 2
    result = {'source': Path(args.input).name, 'frameMs': args.frame_ms,
              'variants': [bake(mesh, width, height, args.frames, tags, args.elevation, args.azimuth) for width, height in sizes]}
    if args.hero:
        result['composedFrom'] = [Path(args.input).name, Path(args.hero).name, Path(args.colossus).name]
        result['palette'] = ['cyan', 'yellow', 'red', 'gray']
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=True, indent=2) + '\n')
    print(f'{output}: {args.frames} angles, {len(sizes)} sizes, {output.stat().st_size} bytes')
