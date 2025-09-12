output "products_routes" {
  description = "Products alias routes (route_key → id)"
  value = {
    (aws_apigatewayv2_route.products_post.route_key)  = aws_apigatewayv2_route.products_post.id
    (aws_apigatewayv2_route.products_get.route_key)   = aws_apigatewayv2_route.products_get.id
    (aws_apigatewayv2_route.products_get_id.route_key)= aws_apigatewayv2_route.products_get_id.id
    (aws_apigatewayv2_route.products_put_id.route_key)= aws_apigatewayv2_route.products_put_id.id
  }
}
