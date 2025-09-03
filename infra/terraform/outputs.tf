output "objects_table_name" {
  value = aws_dynamodb_table.objects.name
}
output "objects_lambda_name" {
  value = aws_lambda_function.objects.function_name
}
output "objects_api_base_url" {
  value = aws_apigatewayv2_api.objects_api.api_endpoint
}
