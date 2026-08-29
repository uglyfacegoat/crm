export type CalendarInterval = {
  id: string;
  startMinute: number;
  endMinute: number;
};

export type PositionedCalendarInterval = CalendarInterval & {
  lane: number;
  laneCount: number;
};

export function layoutCalendarIntervals(intervals: CalendarInterval[]): PositionedCalendarInterval[] {
  const ordered = intervals
    .map((interval) => ({ ...interval, endMinute: Math.max(interval.startMinute + 1, interval.endMinute) }))
    .toSorted((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.id.localeCompare(right.id));
  const positioned: PositionedCalendarInterval[] = [];

  for (let index = 0; index < ordered.length;) {
    const cluster: CalendarInterval[] = [];
    let clusterEnd = ordered[index].endMinute;
    let cursor = index;
    while (cursor < ordered.length && (cursor === index || ordered[cursor].startMinute < clusterEnd)) {
      cluster.push(ordered[cursor]);
      clusterEnd = Math.max(clusterEnd, ordered[cursor].endMinute);
      cursor += 1;
    }

    const laneEnds: number[] = [];
    const clusterPositions = cluster.map((interval) => {
      const reusableLane = laneEnds.findIndex((laneEnd) => laneEnd <= interval.startMinute);
      const lane = reusableLane === -1 ? laneEnds.length : reusableLane;
      laneEnds[lane] = interval.endMinute;
      return { ...interval, lane };
    });
    const laneCount = laneEnds.length;
    positioned.push(...clusterPositions.map((interval) => ({ ...interval, laneCount })));
    index = cursor;
  }

  return positioned;
}
