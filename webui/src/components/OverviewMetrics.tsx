import type { ReactNode } from "react";
import { Card, Col, Flex, Row, Statistic, Typography } from "antd";

export interface OverviewMetric {
  label: string;
  value: number | string;
  icon?: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
}

export function OverviewMetrics({ items }: { items: readonly OverviewMetric[] }) {
  return (
    <Row gutter={16} className="overview-metrics" style={{ marginBottom: 24 }}>
      {items.map((item) => (
        <Col key={item.label} span={6}>
          <Card style={{ height: "100%" }}>
            <Statistic
              title={
                <Flex justify="space-between" align="center" gap={8}>
                  <span>{item.label}</span>
                  {item.icon}
                </Flex>
              }
              value={item.value}
              styles={{
                content: {
                  color: item.danger ? "var(--ant-color-error)" : undefined,
                },
              }}
            />
            {item.hint && (
              <Typography.Text type={item.danger ? "danger" : "secondary"}>
                {item.hint}
              </Typography.Text>
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
