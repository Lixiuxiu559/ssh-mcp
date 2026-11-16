import { Flex, Typography } from "antd";
import type { ReactNode } from "react";

export function PageHeading({
  title,
  extra,
}: {
  title: string;
  extra?: ReactNode;
}) {
  return (
    <Flex justify="space-between" align="center" className="page-heading">
      <Typography.Title level={1}>{title}</Typography.Title>
      {extra}
    </Flex>
  );
}
