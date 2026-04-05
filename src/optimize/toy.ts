// Toy optimization: minimize (x-1)^2 + (y-1)^2
// Expected result: x=1, y=1, value=0

import nlopt from '@/vendor/nlopt'

;(async () => {
  await nlopt.ready

  const opt = new nlopt.Optimize(nlopt.Algorithm.LD_SLSQP, 2)
  opt.setMinObjective((x, grad) => {
    if (grad) {
      grad[0] = 2 * (x[0] - 1)
      grad[1] = 2 * (x[1] - 1)
    }
    return (x[0] - 1) ** 2 + (x[1] - 1) ** 2
  }, 1e-8)

  const result = opt.optimize([5, 5])
  console.log('Toy optimization result:', result)
  console.log(`  x = ${result.x[0]}, y = ${result.x[1]}, value = ${result.value}`)

  nlopt.GC.flush()
})()
